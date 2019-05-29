import {
  Text,
  Fragment,
  Empty,
  Portal,
  normalizeVNode,
  VNode,
  VNodeChildren
} from './vnode'
import {
  ComponentInstance,
  renderComponentRoot,
  shouldUpdateComponent,
  createComponentInstance,
  setupStatefulComponent
} from './component'
import {
  isString,
  isArray,
  isFunction,
  isObject,
  EMPTY_OBJ,
  EMPTY_ARR
} from '@vue/shared'
import { TEXT, CLASS, STYLE, PROPS, KEYED, UNKEYED } from './patchFlags'
import { queueJob, queuePostFlushCb, flushPostFlushCbs } from './scheduler'
import { effect, stop, ReactiveEffectOptions } from '@vue/observer'
import { resolveProps } from './componentProps'

const prodEffectOptions = {
  scheduler: queueJob
}

function createDevEffectOptions(
  instance: ComponentInstance
): ReactiveEffectOptions {
  return {
    scheduler: queueJob,
    onTrack: instance.rtc
      ? e => invokeHooks(instance.rtc as Function[], e)
      : void 0,
    onTrigger: instance.rtg
      ? e => invokeHooks(instance.rtg as Function[], e)
      : void 0
  }
}

function isSameType(n1: VNode, n2: VNode): boolean {
  return n1.type === n2.type && n1.key === n2.key
}

function invokeHooks(hooks: Function[], arg?: any) {
  for (let i = 0; i < hooks.length; i++) {
    hooks[i](arg)
  }
}

export type HostNode = any

export interface RendererOptions {
  patchProp(
    el: HostNode,
    key: string,
    value: any,
    oldValue: any,
    isSVG: boolean,
    prevChildren?: VNode[],
    unmountChildren?: (children: VNode[]) => void
  ): void
  insert(el: HostNode, parent: HostNode, anchor?: HostNode): void
  remove(el: HostNode): void
  createElement(type: string): HostNode
  createText(text: string): HostNode
  createComment(text: string): HostNode
  setText(node: HostNode, text: string): void
  setElementText(node: HostNode, text: string): void
  parentNode(node: HostNode): HostNode | null
  nextSibling(node: HostNode): HostNode | null
  querySelector(selector: string): HostNode | null
}

export function createRenderer(options: RendererOptions) {
  const {
    insert: hostInsert,
    remove: hostRemove,
    patchProp: hostPatchProp,
    createElement: hostCreateElement,
    createText: hostCreateText,
    createComment: hostCreateComment,
    setText: hostSetText,
    setElementText: hostSetElementText,
    parentNode: hostParentNode,
    nextSibling: hostNextSibling,
    querySelector: hostQuerySelector
  } = options

  function patch(
    n1: VNode | null, // null means this is a mount
    n2: VNode,
    container: HostNode,
    anchor?: HostNode,
    optimized?: boolean
  ) {
    // patching & not same type, unmount old tree
    if (n1 != null && !isSameType(n1, n2)) {
      anchor = getNextHostNode(n1)
      unmount(n1, true)
      n1 = null
    }

    const { type } = n2
    switch (type) {
      case Text:
        processText(n1, n2, container, anchor)
        break
      case Empty:
        processEmptyNode(n1, n2, container, anchor)
        break
      case Fragment:
        processFragment(n1, n2, container, anchor, optimized)
        break
      case Portal:
        processPortal(n1, n2, container, anchor, optimized)
        break
      default:
        if (isString(type)) {
          processElement(n1, n2, container, anchor, optimized)
        } else {
          if (__DEV__ && !isFunction(type) && !isObject(type)) {
            // TODO warn invalid node type
            debugger
          }
          processComponent(n1, n2, container, anchor)
        }
        break
    }
  }

  function processText(
    n1: VNode | null,
    n2: VNode,
    container: HostNode,
    anchor?: HostNode
  ) {
    if (n1 == null) {
      hostInsert(
        (n2.el = hostCreateText(n2.children as string)),
        container,
        anchor
      )
    } else {
      const el = (n2.el = n1.el)
      if (n2.children !== n1.children) {
        hostSetText(el, n2.children as string)
      }
    }
  }

  function processEmptyNode(
    n1: VNode | null,
    n2: VNode,
    container: HostNode,
    anchor?: HostNode
  ) {
    if (n1 == null) {
      hostInsert((n2.el = hostCreateComment('')), container, anchor)
    } else {
      n2.el = n1.el
    }
  }

  function processElement(
    n1: VNode | null,
    n2: VNode,
    container: HostNode,
    anchor?: HostNode,
    optimized?: boolean
  ) {
    // mount
    if (n1 == null) {
      mountElement(n2, container, anchor)
    } else {
      patchElement(n1, n2, optimized)
    }
  }

  function mountElement(vnode: VNode, container: HostNode, anchor?: HostNode) {
    const el = (vnode.el = hostCreateElement(vnode.type as string))
    if (vnode.props != null) {
      for (const key in vnode.props) {
        hostPatchProp(el, key, vnode.props[key], null, false)
      }
    }
    if (isString(vnode.children)) {
      hostSetElementText(el, vnode.children)
    } else if (vnode.children != null) {
      mountChildren(vnode.children, el)
    }
    hostInsert(el, container, anchor)
  }

  function mountChildren(
    children: VNodeChildren,
    container: HostNode,
    anchor?: HostNode,
    start: number = 0
  ) {
    for (let i = start; i < children.length; i++) {
      const child = (children[i] = normalizeVNode(children[i]))
      patch(null, child, container, anchor)
    }
  }

  function patchElement(n1: VNode, n2: VNode, optimized?: boolean) {
    const el = (n2.el = n1.el)
    const { patchFlag, dynamicChildren } = n2
    const oldProps = (n1 && n1.props) || EMPTY_OBJ
    const newProps = n2.props || EMPTY_OBJ

    if (patchFlag != null) {
      // the presence of a patchFlag means this element's render code was
      // generated by the compiler and can take the fast path.
      // in this path old node and new node are guaranteed to have the same shape
      // (i.e. at the exact same position in the source template)

      // class
      // this flag is matched when the element has dynamic class bindings.
      if (patchFlag & CLASS) {
        // TODO handle full class API, potentially optimize at compilation stage?
        if (oldProps.class !== newProps.class) {
          hostPatchProp(el, 'class', newProps.class, null, false)
        }
      }

      // style
      // this flag is matched when the element has dynamic style bindings
      // TODO separate static and dynamic styles?
      if (patchFlag & STYLE) {
        hostPatchProp(el, 'style', newProps.style, oldProps.style, false)
      }

      // props
      // This flag is matched when the element has dynamic prop/attr bindings
      // other than class and style. The keys of dynamic prop/attrs are saved for
      // faster iteration.
      // Note dynamic keys like :[foo]="bar" will cause this optimization to
      // bail out and go through a full diff because we need to unset the old key
      if (patchFlag & PROPS) {
        // if the flag is present then dynamicProps must be non-null
        const propsToUpdate = n2.dynamicProps as string[]
        for (let i = 0; i < propsToUpdate.length; i++) {
          const key = propsToUpdate[i]
          const prev = oldProps[key]
          const next = newProps[key]
          if (prev !== next) {
            hostPatchProp(
              el,
              key,
              next,
              prev,
              false,
              n1.children as VNode[],
              unmountChildren
            )
          }
        }
      }

      // text
      // This flag is matched when the element has only dynamic text children.
      // this flag is terminal (i.e. skips children diffing).
      if (patchFlag & TEXT) {
        if (n1.children !== n2.children) {
          hostSetElementText(el, n2.children as string)
        }
        return // terminal
      }
    } else if (!optimized) {
      // unoptimized, full diff
      patchProps(el, n2, oldProps, newProps)
    }

    if (dynamicChildren != null) {
      // children fast path
      const olddynamicChildren = n1.dynamicChildren as VNode[]
      for (let i = 0; i < dynamicChildren.length; i++) {
        patch(olddynamicChildren[i], dynamicChildren[i], el, null, true)
      }
    } else if (!optimized) {
      // full diff
      patchChildren(n1, n2, el)
    }
  }

  function patchProps(
    el: HostNode,
    vnode: VNode,
    oldProps: any,
    newProps: any
  ) {
    if (oldProps !== newProps) {
      for (const key in newProps) {
        const next = newProps[key]
        const prev = oldProps[key]
        if (next !== prev) {
          hostPatchProp(
            el,
            key,
            next,
            prev,
            false,
            vnode.children as VNode[],
            unmountChildren
          )
        }
      }
      if (oldProps !== EMPTY_OBJ) {
        for (const key in oldProps) {
          if (!(key in newProps)) {
            hostPatchProp(
              el,
              key,
              null,
              null,
              false,
              vnode.children as VNode[],
              unmountChildren
            )
          }
        }
      }
    }
  }

  function processFragment(
    n1: VNode | null,
    n2: VNode,
    container: HostNode,
    anchor?: HostNode,
    optimized?: boolean
  ) {
    const fragmentStartAnchor = (n2.el = n1 ? n1.el : hostCreateComment(''))
    const fragmentEndAnchor = (n2.anchor = n1
      ? n1.anchor
      : hostCreateComment(''))
    if (n1 == null) {
      hostInsert(fragmentStartAnchor, container, anchor)
      hostInsert(fragmentEndAnchor, container, anchor)
      // a fragment can only have array children
      mountChildren(n2.children as VNodeChildren, container, fragmentEndAnchor)
    } else {
      patchChildren(n1, n2, container, fragmentEndAnchor, optimized)
    }
  }

  function processPortal(
    n1: VNode | null,
    n2: VNode,
    container: HostNode,
    anchor?: HostNode,
    optimized?: boolean
  ) {
    const targetSelector = n2.props && n2.props.target
    if (n1 == null) {
      const children = n2.children
      const target = (n2.target = isString(targetSelector)
        ? hostQuerySelector(targetSelector)
        : null)
      if (target != null) {
        if (isString(children)) {
          hostSetElementText(target, children)
        } else if (children != null) {
          mountChildren(children, target)
        }
      } else {
        // TODO warn missing or invalid target
      }
    } else {
      // update content
      const target = (n2.target = n1.target)
      if (n2.patchFlag === TEXT) {
        hostSetElementText(target, n2.children as string)
      } else if (!optimized) {
        patchChildren(n1, n2, target)
      }
      // target changed
      if (targetSelector !== (n1.props && n1.props.target)) {
        const nextTarget = (n2.target = isString(targetSelector)
          ? hostQuerySelector(targetSelector)
          : null)
        if (nextTarget != null) {
          // move content
          const children = n2.children
          if (isString(children)) {
            hostSetElementText(target, '')
            hostSetElementText(nextTarget, children)
          } else if (children != null) {
            for (let i = 0; i < children.length; i++) {
              move(children[i] as VNode, nextTarget, null)
            }
          }
        } else {
          // TODO warn missing or invalid target
        }
      }
    }
    // insert an empty node as the placeholder for the portal
    processEmptyNode(n1, n2, container, anchor)
  }

  function processComponent(
    n1: VNode | null,
    n2: VNode,
    container: HostNode,
    anchor?: HostNode
  ) {
    if (n1 == null) {
      mountComponent(n2, container, anchor)
    } else {
      const instance = (n2.component = n1.component) as ComponentInstance
      if (shouldUpdateComponent(n1, n2)) {
        instance.next = n2
        instance.update()
      } else {
        n2.el = n1.el
      }
    }
  }

  function mountComponent(
    vnode: VNode,
    container: HostNode,
    anchor?: HostNode
  ) {
    const Component = vnode.type as any
    const instance: ComponentInstance = (vnode.component = createComponentInstance(
      Component
    ))
    instance.update = effect(() => {
      if (!instance.vnode) {
        // initial mount
        instance.vnode = vnode
        resolveProps(instance, vnode.props, Component.props)
        // setup stateful
        if (typeof Component === 'object' && Component.setup) {
          setupStatefulComponent(instance)
        }
        const subTree = (instance.subTree = renderComponentRoot(instance))
        // beforeMount hook
        if (instance.bm !== null) {
          invokeHooks(instance.bm)
        }
        patch(null, subTree, container, anchor)
        vnode.el = subTree.el
        // mounted hook
        if (instance.m !== null) {
          queuePostFlushCb(instance.m)
        }
      } else {
        // component update
        // This is triggered by mutation of component's own state (next: null)
        // OR parent calling processComponent (next: VNode)
        const { next } = instance
        if (next != null) {
          next.component = instance
          instance.vnode = next
          instance.next = null
          resolveProps(instance, next.props, Component.props)
          // TODO slots
        }
        const prevTree = instance.subTree
        const nextTree = (instance.subTree = renderComponentRoot(instance))
        // beforeUpdate hook
        if (instance.bu !== null) {
          invokeHooks(instance.bu)
        }
        patch(
          prevTree,
          nextTree,
          // may have moved
          hostParentNode(prevTree.el),
          getNextHostNode(prevTree)
        )
        if (next != null) {
          next.el = nextTree.el
        }
        // upated hook
        if (instance.u !== null) {
          queuePostFlushCb(instance.u)
        }
      }
    }, __DEV__ ? createDevEffectOptions(instance) : prodEffectOptions)
  }

  function patchChildren(
    n1: VNode | null,
    n2: VNode,
    container: HostNode,
    anchor?: HostNode,
    optimized?: boolean
  ) {
    const c1 = n1 && n1.children
    const c2 = n2.children

    // fast path
    const { patchFlag } = n2
    if (patchFlag != null) {
      if (patchFlag & KEYED) {
        // this could be either fully-keyed or mixed (some keyed some not)
        // presence of patchFlag means children are guaranteed to be arrays
        patchKeyedChildren(
          c1 as VNode[],
          c2 as VNodeChildren,
          container,
          anchor,
          optimized
        )
        return
      } else if (patchFlag & UNKEYED) {
        // unkeyed
        patchUnkeyedChildren(
          c1 as VNode[],
          c2 as VNodeChildren,
          container,
          anchor,
          optimized
        )
        return
      }
    }

    if (isString(c2)) {
      // text children fast path
      if (isArray(c1)) {
        unmountChildren(c1 as VNode[])
      }
      hostSetElementText(container, c2)
    } else {
      if (isString(c1)) {
        hostSetElementText(container, '')
        if (c2 != null) {
          mountChildren(c2, container, anchor)
        }
      } else if (isArray(c1)) {
        if (isArray(c2)) {
          // two arrays, cannot assume anything, do full diff
          patchKeyedChildren(c1 as VNode[], c2, container, anchor, optimized)
        } else {
          // c2 is null in this case
          unmountChildren(c1 as VNode[], true)
        }
      }
    }
  }

  function patchUnkeyedChildren(
    c1: VNode[],
    c2: VNodeChildren,
    container: HostNode,
    anchor?: HostNode,
    optimized?: boolean
  ) {
    c1 = c1 || EMPTY_ARR
    c2 = c2 || EMPTY_ARR
    const oldLength = c1.length
    const newLength = c2.length
    const commonLength = Math.min(oldLength, newLength)
    let i
    for (i = 0; i < commonLength; i++) {
      const nextChild = (c2[i] = normalizeVNode(c2[i]))
      patch(c1[i], nextChild, container, null, optimized)
    }
    if (oldLength > newLength) {
      // remove old
      unmountChildren(c1, true, commonLength)
    } else {
      // mount new
      mountChildren(c2, container, anchor, commonLength)
    }
  }

  // can be all-keyed or mixed
  function patchKeyedChildren(
    c1: VNode[],
    c2: VNodeChildren,
    container: HostNode,
    parentAnchor?: HostNode,
    optimized?: boolean
  ) {
    let i = 0
    const l2 = c2.length
    let e1 = c1.length - 1 // prev ending index
    let e2 = l2 - 1 // next ending index

    // 1. sync from start
    // (a b) c
    // (a b) d e
    while (i <= e1 && i <= e2) {
      const n1 = c1[i]
      const n2 = (c2[i] = normalizeVNode(c2[i]))
      if (isSameType(n1, n2)) {
        patch(n1, n2, container, parentAnchor, optimized)
      } else {
        break
      }
      i++
    }

    // 2. sync from end
    // a (b c)
    // d e (b c)
    while (i <= e1 && i <= e2) {
      const n1 = c1[e1]
      const n2 = (c2[e2] = normalizeVNode(c2[e2]))
      if (isSameType(n1, n2)) {
        patch(n1, n2, container, parentAnchor, optimized)
      } else {
        break
      }
      e1--
      e2--
    }

    // 3. common sequence + mount
    // (a b)
    // (a b) c
    // i = 2, e1 = 1, e2 = 2
    // (a b)
    // c (a b)
    // i = 0, e1 = -1, e2 = 0
    if (i > e1) {
      if (i <= e2) {
        const nextPos = e2 + 1
        const anchor = nextPos < l2 ? (c2[nextPos] as VNode).el : parentAnchor
        while (i <= e2) {
          patch(null, (c2[i] = normalizeVNode(c2[i])), container, anchor)
          i++
        }
      }
    }

    // 4. common sequence + unmount
    // (a b) c
    // (a b)
    // i = 2, e1 = 2, e2 = 1
    // a (b c)
    // (b c)
    // i = 0, e1 = 0, e2 = -1
    else if (i > e2) {
      while (i <= e1) {
        unmount(c1[i], true)
        i++
      }
    }

    // 5. unknown sequence
    // [i ... e1 + 1]: a b [c d e] f g
    // [i ... e2 + 1]: a b [e d c h] f g
    // i = 2, e1 = 4, e2 = 5
    else {
      const s1 = i // prev starting index
      const s2 = i // next starting index

      // 5.1 build key:index map for newChildren
      const keyToNewIndexMap: Map<any, number> = new Map()
      for (i = s2; i <= e2; i++) {
        const nextChild = (c2[i] = normalizeVNode(c2[i]))
        if (nextChild.key != null) {
          // TODO warn duplicate keys
          keyToNewIndexMap.set(nextChild.key, i)
        }
      }

      // 5.2 loop through old children left to be patched and try to patch
      // matching nodes & remove nodes that are no longer present
      let j
      let patched = 0
      const toBePatched = e2 - s2 + 1
      let moved = false
      // used to track whether any node has moved
      let maxNewIndexSoFar = 0
      // works as Map<newIndex, oldIndex>
      // Note that oldIndex is offset by +1
      // and oldIndex = 0 is a special value indicating the new node has
      // no corresponding old node.
      // used for determining longest stable subsequence
      const newIndexToOldIndexMap = []
      for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap.push(0)

      for (i = s1; i <= e1; i++) {
        const prevChild = c1[i]
        if (patched >= toBePatched) {
          // all new children have been patched so this can only be a removal
          unmount(prevChild, true)
          continue
        }
        let newIndex
        if (prevChild.key != null) {
          newIndex = keyToNewIndexMap.get(prevChild.key)
        } else {
          // key-less node, try to locate a key-less node of the same type
          for (j = s2; j <= e2; j++) {
            if (isSameType(prevChild, c2[j] as VNode)) {
              newIndex = j
              break
            }
          }
        }
        if (newIndex === undefined) {
          unmount(prevChild, true)
        } else {
          newIndexToOldIndexMap[newIndex - s2] = i + 1
          if (newIndex >= maxNewIndexSoFar) {
            maxNewIndexSoFar = newIndex
          } else {
            moved = true
          }
          patch(prevChild, c2[newIndex] as VNode, container, null, optimized)
          patched++
        }
      }

      // 5.3 move and mount
      // generate longest stable subsequence only when nodes have moved
      const increasingNewIndexSequence = moved
        ? getSequence(newIndexToOldIndexMap)
        : EMPTY_ARR
      j = increasingNewIndexSequence.length - 1
      // looping backwards so that we can use last patched node as anchor
      for (i = toBePatched - 1; i >= 0; i--) {
        const nextIndex = s2 + i
        const nextChild = c2[nextIndex] as VNode
        const anchor =
          nextIndex + 1 < l2 ? (c2[nextIndex + 1] as VNode).el : parentAnchor
        if (newIndexToOldIndexMap[i] === 0) {
          // mount new
          patch(null, nextChild, container, anchor)
        } else if (moved) {
          // move if:
          // There is no stable subsequence (e.g. a reverse)
          // OR current node is not among the stable sequence
          if (j < 0 || i !== increasingNewIndexSequence[j]) {
            move(nextChild, container, anchor)
          } else {
            j--
          }
        }
      }
    }
  }

  function move(vnode: VNode, container: HostNode, anchor: HostNode) {
    if (vnode.component != null) {
      move(vnode.component.subTree, container, anchor)
      return
    }
    if (vnode.type === Fragment) {
      hostInsert(vnode.el, container, anchor)
      const children = vnode.children as VNode[]
      for (let i = 0; i < children.length; i++) {
        hostInsert(children[i].el, container, anchor)
      }
      hostInsert(vnode.anchor, container, anchor)
    } else {
      hostInsert(vnode.el, container, anchor)
    }
  }

  function unmount(vnode: VNode, doRemove?: boolean) {
    const instance = vnode.component
    if (instance != null) {
      unmountComponent(instance, doRemove)
      return
    }
    const shouldRemoveChildren = vnode.type === Fragment && doRemove
    if (vnode.dynamicChildren != null) {
      unmountChildren(vnode.dynamicChildren, shouldRemoveChildren)
    } else if (isArray(vnode.children)) {
      unmountChildren(vnode.children as VNode[], shouldRemoveChildren)
    }
    if (doRemove) {
      hostRemove(vnode.el)
      if (vnode.anchor != null) hostRemove(vnode.anchor)
    }
  }

  function unmountComponent(
    { bum, effects, update, subTree, um }: ComponentInstance,
    doRemove?: boolean
  ) {
    // beforeUnmount hook
    if (bum !== null) {
      invokeHooks(bum)
    }
    if (effects !== null) {
      for (let i = 0; i < effects.length; i++) {
        stop(effects[i])
      }
    }
    stop(update)
    unmount(subTree, doRemove)
    // unmounted hook
    if (um !== null) {
      queuePostFlushCb(um)
    }
  }

  function unmountChildren(
    children: VNode[],
    doRemove?: boolean,
    start: number = 0
  ) {
    for (let i = start; i < children.length; i++) {
      unmount(children[i], doRemove)
    }
  }

  function getNextHostNode(vnode: VNode): HostNode {
    return vnode.component === null
      ? hostNextSibling(vnode.anchor || vnode.el)
      : getNextHostNode(vnode.component.subTree)
  }

  return function render(vnode: VNode | null, dom: HostNode): VNode | null {
    if (vnode == null) {
      if (dom._vnode) {
        unmount(dom._vnode, true)
      }
    } else {
      patch(dom._vnode, vnode, dom)
    }
    flushPostFlushCbs()
    return (dom._vnode = vnode)
  }
}

// https://en.wikipedia.org/wiki/Longest_increasing_subsequence
function getSequence(arr: number[]): number[] {
  const p = arr.slice()
  const result = [0]
  let i
  let j
  let u
  let v
  let c
  const len = arr.length
  for (i = 0; i < len; i++) {
    const arrI = arr[i]
    if (arrI !== 0) {
      j = result[result.length - 1]
      if (arr[j] < arrI) {
        p[i] = j
        result.push(i)
        continue
      }
      u = 0
      v = result.length - 1
      while (u < v) {
        c = ((u + v) / 2) | 0
        if (arr[result[c]] < arrI) {
          u = c + 1
        } else {
          v = c
        }
      }
      if (arrI < arr[result[u]]) {
        if (u > 0) {
          p[i] = result[u - 1]
        }
        result[u] = i
      }
    }
  }
  u = result.length
  v = result[u - 1]
  while (u-- > 0) {
    result[u] = v
    v = p[v]
  }
  return result
}
