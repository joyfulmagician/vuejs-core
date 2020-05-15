/**
 * This module is Node-only.
 */
import {
  NodeTypes,
  ElementNode,
  TransformContext,
  TemplateChildNode,
  SimpleExpressionNode,
  createCallExpression,
  HoistTransform,
  CREATE_STATIC,
  ExpressionNode,
  ElementTypes,
  PlainElementNode,
  JSChildNode,
  TextCallNode
} from '@vue/compiler-core'
import {
  isVoidTag,
  isString,
  isSymbol,
  isKnownAttr,
  escapeHtml,
  toDisplayString,
  normalizeClass,
  normalizeStyle,
  stringifyStyle
} from '@vue/shared'

export const enum StringifyThresholds {
  ELEMENT_WITH_BINDING_COUNT = 5,
  NODE_COUNT = 20
}

type StringiableNode = PlainElementNode | TextCallNode

// Turn eligible hoisted static trees into stringied static nodes, e.g.
//   const _hoisted_1 = createStaticVNode(`<div class="foo">bar</div>`)
// This is only performed in non-in-browser compilations.
export const stringifyStatic: HoistTransform = (children, context) => {
  let nc = 0 // current node count
  let ec = 0 // current element with binding count
  const currentChunk: StringiableNode[] = []

  const stringifyCurrentChunk = (currentIndex: number): number => {
    if (
      nc >= StringifyThresholds.NODE_COUNT ||
      ec >= StringifyThresholds.ELEMENT_WITH_BINDING_COUNT
    ) {
      // combine all currently eligible nodes into a single static vnode call
      const staticCall = createCallExpression(context.helper(CREATE_STATIC), [
        JSON.stringify(
          currentChunk.map(node => stringifyNode(node, context)).join('')
        ),
        // the 2nd argument indicates the number of DOM nodes this static vnode
        // will insert / hydrate
        String(currentChunk.length)
      ])
      // replace the first node's hoisted expression with the static vnode call
      replaceHoist(currentChunk[0], staticCall, context)

      if (currentChunk.length > 1) {
        for (let i = 1; i < currentChunk.length; i++) {
          // for the merged nodes, set their hoisted expression to null
          replaceHoist(currentChunk[i], null, context)
        }

        // also remove merged nodes from children
        const deleteCount = currentChunk.length - 1
        children.splice(currentIndex - currentChunk.length + 1, deleteCount)
        return deleteCount
      }
    }
    return 0
  }

  let i = 0
  for (; i < children.length; i++) {
    const child = children[i]
    const hoisted = getHoistedNode(child)
    if (hoisted) {
      // presence of hoisted means child must be a stringifiable node
      const node = child as StringiableNode
      const result = analyzeNode(node)
      if (result) {
        // node is stringifiable, record state
        nc += result[0]
        ec += result[1]
        currentChunk.push(node)
        continue
      }
    }
    // we only reach here if we ran into a node that is not stringifiable
    // check if currently analyzed nodes meet criteria for stringification.
    // adjust iteration index
    i -= stringifyCurrentChunk(i)
    // reset state
    nc = 0
    ec = 0
    currentChunk.length = 0
  }
  // in case the last node was also stringifiable
  stringifyCurrentChunk(i)
}

const getHoistedNode = (node: TemplateChildNode) =>
  ((node.type === NodeTypes.ELEMENT && node.tagType === ElementTypes.ELEMENT) ||
    node.type == NodeTypes.TEXT_CALL) &&
  node.codegenNode &&
  node.codegenNode.type === NodeTypes.SIMPLE_EXPRESSION &&
  node.codegenNode.hoisted

const dataAriaRE = /^(data|aria)-/
const isStringifiableAttr = (name: string) => {
  return isKnownAttr(name) || dataAriaRE.test(name)
}

const replaceHoist = (
  node: StringiableNode,
  replacement: JSChildNode | null,
  context: TransformContext
) => {
  const hoistToReplace = (node.codegenNode as SimpleExpressionNode).hoisted!
  context.hoists[context.hoists.indexOf(hoistToReplace)] = replacement
}

/**
 * for a hoisted node, analyze it and return:
 * - false: bailed (contains runtime constant)
 * - [nc, ec] where
 *   - nc is the number of nodes inside
 *   - ec is the number of element with bindings inside
 */
function analyzeNode(node: StringiableNode): [number, number] | false {
  if (node.type === NodeTypes.TEXT_CALL) {
    return [1, 0]
  }

  let nc = 1 // node count
  let ec = node.props.length > 0 ? 1 : 0 // element w/ binding count
  let bailed = false
  const bail = (): false => {
    bailed = true
    return false
  }

  // TODO: check for cases where using innerHTML will result in different
  // output compared to imperative node insertions.
  // probably only need to check for most common case
  // i.e. non-phrasing-content tags inside `<p>`
  function walk(node: ElementNode): boolean {
    for (let i = 0; i < node.props.length; i++) {
      const p = node.props[i]
      // bail on non-attr bindings
      if (p.type === NodeTypes.ATTRIBUTE && !isStringifiableAttr(p.name)) {
        return bail()
      }
      if (p.type === NodeTypes.DIRECTIVE && p.name === 'bind') {
        // bail on non-attr bindings
        if (
          p.arg &&
          (p.arg.type === NodeTypes.COMPOUND_EXPRESSION ||
            (p.arg.isStatic && !isStringifiableAttr(p.arg.content)))
        ) {
          return bail()
        }
        // some transforms, e.g. `transformAssetUrls` in `@vue/compiler-sfc` may
        // convert static attributes into a v-bind with a constnat expresion.
        // Such constant bindings are eligible for hoisting but not for static
        // stringification because they cannot be pre-evaluated.
        if (
          p.exp &&
          (p.exp.type === NodeTypes.COMPOUND_EXPRESSION ||
            p.exp.isRuntimeConstant)
        ) {
          return bail()
        }
      }
    }
    for (let i = 0; i < node.children.length; i++) {
      nc++
      if (nc >= StringifyThresholds.NODE_COUNT) {
        return true
      }
      const child = node.children[i]
      if (child.type === NodeTypes.ELEMENT) {
        if (child.props.length > 0) {
          ec++
          if (ec >= StringifyThresholds.ELEMENT_WITH_BINDING_COUNT) {
            return true
          }
        }
        walk(child)
        if (bailed) {
          return false
        }
      }
    }
    return true
  }

  return walk(node) ? [nc, ec] : false
}

function stringifyNode(
  node: string | TemplateChildNode,
  context: TransformContext
): string {
  if (isString(node)) {
    return node
  }
  if (isSymbol(node)) {
    return ``
  }
  switch (node.type) {
    case NodeTypes.ELEMENT:
      return stringifyElement(node, context)
    case NodeTypes.TEXT:
      return escapeHtml(node.content)
    case NodeTypes.COMMENT:
      return `<!--${escapeHtml(node.content)}-->`
    case NodeTypes.INTERPOLATION:
      return escapeHtml(toDisplayString(evaluateConstant(node.content)))
    case NodeTypes.COMPOUND_EXPRESSION:
      return escapeHtml(evaluateConstant(node))
    case NodeTypes.TEXT_CALL:
      return stringifyNode(node.content, context)
    default:
      // static trees will not contain if/for nodes
      return ''
  }
}

function stringifyElement(
  node: ElementNode,
  context: TransformContext
): string {
  let res = `<${node.tag}`
  for (let i = 0; i < node.props.length; i++) {
    const p = node.props[i]
    if (p.type === NodeTypes.ATTRIBUTE) {
      res += ` ${p.name}`
      if (p.value) {
        res += `="${escapeHtml(p.value.content)}"`
      }
    } else if (p.type === NodeTypes.DIRECTIVE && p.name === 'bind') {
      // constant v-bind, e.g. :foo="1"
      let evaluated = evaluateConstant(p.exp as SimpleExpressionNode)
      const arg = p.arg && (p.arg as SimpleExpressionNode).content
      if (arg === 'class') {
        evaluated = normalizeClass(evaluated)
      } else if (arg === 'style') {
        evaluated = stringifyStyle(normalizeStyle(evaluated))
      }
      res += ` ${(p.arg as SimpleExpressionNode).content}="${escapeHtml(
        evaluated
      )}"`
    }
  }
  if (context.scopeId) {
    res += ` ${context.scopeId}`
  }
  res += `>`
  for (let i = 0; i < node.children.length; i++) {
    res += stringifyNode(node.children[i], context)
  }
  if (!isVoidTag(node.tag)) {
    res += `</${node.tag}>`
  }
  return res
}

// __UNSAFE__
// Reason: eval.
// It's technically safe to eval because only constant expressions are possible
// here, e.g. `{{ 1 }}` or `{{ 'foo' }}`
// in addition, constant exps bail on presence of parens so you can't even
// run JSFuck in here. But we mark it unsafe for security review purposes.
// (see compiler-core/src/transformExpressions)
function evaluateConstant(exp: ExpressionNode): string {
  if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
    return new Function(`return ${exp.content}`)()
  } else {
    // compound
    let res = ``
    exp.children.forEach(c => {
      if (isString(c) || isSymbol(c)) {
        return
      }
      if (c.type === NodeTypes.TEXT) {
        res += c.content
      } else if (c.type === NodeTypes.INTERPOLATION) {
        res += toDisplayString(evaluateConstant(c.content))
      } else {
        res += evaluateConstant(c)
      }
    })
    return res
  }
}
