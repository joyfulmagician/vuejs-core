import {
  Text,
  Fragment,
  Comment,
  cloneIfMounted,
  normalizeVNode,
  VNode,
  VNodeArrayChildren,
  createVNode,
  isSameVNodeType,
  Static,
  VNodeNormalizedRef,
  VNodeHook,
  isVNode
} from './vnode'
import {
  ComponentInternalInstance,
  createComponentInstance,
  Data,
  setupComponent
} from './component'
import {
  renderComponentRoot,
  shouldUpdateComponent,
  updateHOCHostEl
} from './componentRenderUtils'
import {
  isString,
  EMPTY_OBJ,
  EMPTY_ARR,
  isReservedProp,
  isFunction,
  PatchFlags,
  ShapeFlags,
  NOOP,
  hasOwn,
  invokeArrayFns,
  isArray
} from '@vue/shared'
import {
  queueJob,
  queuePostFlushCb,
  flushPostFlushCbs,
  invalidateJob
} from './scheduler'
import { effect, stop, ReactiveEffectOptions, isRef } from '@vue/reactivity'
import { updateProps } from './componentProps'
import { updateSlots } from './componentSlots'
import { pushWarningContext, popWarningContext, warn } from './warning'
import { createAppAPI, CreateAppFunction } from './apiCreateApp'
import {
  SuspenseBoundary,
  queueEffectWithSuspense,
  SuspenseImpl
} from './components/Suspense'
import { TeleportImpl } from './components/Teleport'
import { isKeepAlive, KeepAliveContext } from './components/KeepAlive'
import { registerHMR, unregisterHMR, isHmrUpdating } from './hmr'
import {
  ErrorCodes,
  callWithErrorHandling,
  callWithAsyncErrorHandling
} from './errorHandling'
import { createHydrationFunctions, RootHydrateFunction } from './hydration'
import { invokeDirectiveHook } from './directives'
import { startMeasure, endMeasure } from './profiling'
import { ComponentPublicInstance } from './componentProxy'

export interface Renderer<HostElement = any> {
  render: RootRenderFunction<HostElement>
  createApp: CreateAppFunction<HostElement>
}

export interface HydrationRenderer extends Renderer<Element> {
  hydrate: RootHydrateFunction
}

export type RootRenderFunction<HostElement = RendererElement> = (
  vnode: VNode | null,
  container: HostElement
) => void

export interface RendererOptions<
  HostNode = RendererNode,
  HostElement = RendererElement
> {
  patchProp(
    el: HostElement,
    key: string,
    prevValue: any,
    nextValue: any,
    isSVG?: boolean,
    prevChildren?: VNode<HostNode, HostElement>[],
    parentComponent?: ComponentInternalInstance | null,
    parentSuspense?: SuspenseBoundary | null,
    unmountChildren?: UnmountChildrenFn
  ): void
  forcePatchProp?(el: HostElement, key: string): boolean
  insert(el: HostNode, parent: HostElement, anchor?: HostNode | null): void
  remove(el: HostNode): void
  createElement(
    type: string,
    isSVG?: boolean,
    isCustomizedBuiltIn?: string
  ): HostElement
  createText(text: string): HostNode
  createComment(text: string): HostNode
  setText(node: HostNode, text: string): void
  setElementText(node: HostElement, text: string): void
  parentNode(node: HostNode): HostElement | null
  nextSibling(node: HostNode): HostNode | null
  querySelector?(selector: string): HostElement | null
  setScopeId?(el: HostElement, id: string): void
  cloneNode?(node: HostNode): HostNode
  insertStaticContent?(
    content: string,
    parent: HostElement,
    anchor: HostNode | null,
    isSVG: boolean
  ): HostElement[]
}

// Renderer Node can technically be any object in the context of core renderer
// logic - they are never directly operated on and always passed to the node op
// functions provided via options, so the internal constraint is really just
// a generic object.
export interface RendererNode {
  [key: string]: any
}

export interface RendererElement extends RendererNode {}

// An object exposing the internals of a renderer, passed to tree-shakeable
// features so that they can be decoupled from this file. Keys are shortened
// to optimize bundle size.
export interface RendererInternals<
  HostNode = RendererNode,
  HostElement = RendererElement
> {
  p: PatchFn
  um: UnmountFn
  r: RemoveFn
  m: MoveFn
  mt: MountComponentFn
  mc: MountChildrenFn
  pc: PatchChildrenFn
  pbc: PatchBlockChildrenFn
  n: NextFn
  o: RendererOptions<HostNode, HostElement>
}

// These functions are created inside a closure and therefore their types cannot
// be directly exported. In order to avoid maintaining function signatures in
// two places, we declare them once here and use them inside the closure.
type PatchFn = (
  n1: VNode | null, // null means this is a mount
  n2: VNode,
  container: RendererElement,
  anchor?: RendererNode | null,
  parentComponent?: ComponentInternalInstance | null,
  parentSuspense?: SuspenseBoundary | null,
  isSVG?: boolean,
  optimized?: boolean
) => void

type MountChildrenFn = (
  children: VNodeArrayChildren,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized: boolean,
  start?: number
) => void

type PatchChildrenFn = (
  n1: VNode | null,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized?: boolean
) => void

type PatchBlockChildrenFn = (
  oldChildren: VNode[],
  newChildren: VNode[],
  fallbackContainer: RendererElement,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean
) => void

type MoveFn = (
  vnode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  type: MoveType,
  parentSuspense?: SuspenseBoundary | null
) => void

type NextFn = (vnode: VNode) => RendererNode | null

type UnmountFn = (
  vnode: VNode,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  doRemove?: boolean
) => void

type RemoveFn = (vnode: VNode) => void

type UnmountChildrenFn = (
  children: VNode[],
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  doRemove?: boolean,
  start?: number
) => void

export type MountComponentFn = (
  initialVNode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentComponent: ComponentInternalInstance | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized: boolean
) => void

type ProcessTextOrCommentFn = (
  n1: VNode | null,
  n2: VNode,
  container: RendererElement,
  anchor: RendererNode | null
) => void

export type SetupRenderEffectFn = (
  instance: ComponentInternalInstance,
  initialVNode: VNode,
  container: RendererElement,
  anchor: RendererNode | null,
  parentSuspense: SuspenseBoundary | null,
  isSVG: boolean,
  optimized: boolean
) => void

export const enum MoveType {
  ENTER,
  LEAVE,
  REORDER
}

const prodEffectOptions = {
  scheduler: queueJob
}

function createDevEffectOptions(
  instance: ComponentInternalInstance
): ReactiveEffectOptions {
  return {
    scheduler: queueJob,
    onTrack: instance.rtc ? e => invokeArrayFns(instance.rtc!, e) : void 0,
    onTrigger: instance.rtg ? e => invokeArrayFns(instance.rtg!, e) : void 0
  }
}

export const queuePostRenderEffect = __FEATURE_SUSPENSE__
  ? queueEffectWithSuspense
  : queuePostFlushCb

export const setRef = (
  rawRef: VNodeNormalizedRef,
  oldRawRef: VNodeNormalizedRef | null,
  parent: ComponentInternalInstance,
  vnode: VNode | null
) => {
  let value: ComponentPublicInstance | RendererNode | null
  if (!vnode) {
    value = null
  } else {
    if (vnode.shapeFlag & ShapeFlags.STATEFUL_COMPONENT) {
      value = vnode.component!.proxy
    } else {
      value = vnode.el
    }
  }

  const [owner, ref] = rawRef
  if (__DEV__ && !owner) {
    warn(
      `Missing ref owner context. ref cannot be used on hoisted vnodes. ` +
        `A vnode with ref must be created inside the render function.`
    )
    return
  }
  const oldRef = oldRawRef && oldRawRef[1]
  const refs = owner.refs === EMPTY_OBJ ? (owner.refs = {}) : owner.refs
  const setupState = owner.setupState

  // unset old ref
  if (oldRef != null && oldRef !== ref) {
    if (isString(oldRef)) {
      refs[oldRef] = null
      if (hasOwn(setupState, oldRef)) {
        setupState[oldRef] = null
      }
    } else if (isRef(oldRef)) {
      oldRef.value = null
    }
  }

  if (isString(ref)) {
    refs[ref] = value
    if (hasOwn(setupState, ref)) {
      setupState[ref] = value
    }
  } else if (isRef(ref)) {
    ref.value = value
  } else if (isFunction(ref)) {
    callWithErrorHandling(ref, parent, ErrorCodes.FUNCTION_REF, [value, refs])
  } else if (__DEV__) {
    warn('Invalid template ref type:', value, `(${typeof value})`)
  }
}

/**
 * The createRenderer function accepts two generic arguments:
 * HostNode and HostElement, corresponding to Node and Element types in the
 * host environment. For example, for runtime-dom, HostNode would be the DOM
 * `Node` interface and HostElement would be the DOM `Element` interface.
 *
 * Custom renderers can pass in the platform specific types like this:
 *
 * ``` js
 * const { render, createApp } = createRenderer<Node, Element>({
 *   patchProp,
 *   ...nodeOps
 * })
 * ```
 */
export function createRenderer<
  HostNode = RendererNode,
  HostElement = RendererElement
>(options: RendererOptions<HostNode, HostElement>) {
  return baseCreateRenderer<HostNode, HostElement>(options)
}

// Separate API for creating hydration-enabled renderer.
// Hydration logic is only used when calling this function, making it
// tree-shakable.
export function createHydrationRenderer(
  options: RendererOptions<Node, Element>
) {
  return baseCreateRenderer(options, createHydrationFunctions)
}

// overload 1: no hydration
function baseCreateRenderer<
  HostNode = RendererNode,
  HostElement = RendererElement
>(options: RendererOptions<HostNode, HostElement>): Renderer<HostElement>

// overload 2: with hydration
function baseCreateRenderer(
  options: RendererOptions<Node, Element>,
  createHydrationFns: typeof createHydrationFunctions
): HydrationRenderer

// implementation
function baseCreateRenderer(
  options: RendererOptions,
  createHydrationFns?: typeof createHydrationFunctions
): any {
  const {
    insert: hostInsert,
    remove: hostRemove,
    patchProp: hostPatchProp,
    forcePatchProp: hostForcePatchProp,
    createElement: hostCreateElement,
    createText: hostCreateText,
    createComment: hostCreateComment,
    setText: hostSetText,
    setElementText: hostSetElementText,
    parentNode: hostParentNode,
    nextSibling: hostNextSibling,
    setScopeId: hostSetScopeId = NOOP,
    cloneNode: hostCloneNode,
    insertStaticContent: hostInsertStaticContent
  } = options

  // Note: functions inside this closure should use `const xxx = () => {}`
  // style in order to prevent being inlined by minifiers.
  const patch: PatchFn = (
    n1,
    n2,
    container,
    anchor = null,
    parentComponent = null,
    parentSuspense = null,
    isSVG = false,
    optimized = false
  ) => {
    // patching & not same type, unmount old tree
    if (n1 && !isSameVNodeType(n1, n2)) {
      anchor = getNextHostNode(n1)
      unmount(n1, parentComponent, parentSuspense, true)
      n1 = null
    }

    if (n2.patchFlag === PatchFlags.BAIL) {
      optimized = false
      n2.dynamicChildren = null
    }

    const { type, ref, shapeFlag } = n2
    switch (type) {
      case Text:
        processText(n1, n2, container, anchor)
        break
      case Comment:
        processCommentNode(n1, n2, container, anchor)
        break
      case Static:
        if (n1 == null) {
          mountStaticNode(n2, container, anchor, isSVG)
        } else if (__DEV__) {
          patchStaticNode(n1, n2, container, isSVG)
        }
        break
      case Fragment:
        processFragment(
          n1,
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
        break
      default:
        if (shapeFlag & ShapeFlags.ELEMENT) {
          processElement(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
          )
        } else if (shapeFlag & ShapeFlags.COMPONENT) {
          processComponent(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
          )
        } else if (shapeFlag & ShapeFlags.TELEPORT) {
          ;(type as typeof TeleportImpl).process(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized,
            internals
          )
        } else if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
          ;(type as typeof SuspenseImpl).process(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized,
            internals
          )
        } else if (__DEV__) {
          warn('Invalid VNode type:', type, `(${typeof type})`)
        }
    }

    // set ref
    if (ref != null && parentComponent) {
      setRef(ref, n1 && n1.ref, parentComponent, n2)
    }
  }

  const processText: ProcessTextOrCommentFn = (n1, n2, container, anchor) => {
    if (n1 == null) {
      hostInsert(
        (n2.el = hostCreateText(n2.children as string)),
        container,
        anchor
      )
    } else {
      const el = (n2.el = n1.el!)
      if (n2.children !== n1.children) {
        hostSetText(el, n2.children as string)
      }
    }
  }

  const processCommentNode: ProcessTextOrCommentFn = (
    n1,
    n2,
    container,
    anchor
  ) => {
    if (n1 == null) {
      hostInsert(
        (n2.el = hostCreateComment((n2.children as string) || '')),
        container,
        anchor
      )
    } else {
      // there's no support for dynamic comments
      n2.el = n1.el
    }
  }

  const mountStaticNode = (
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    isSVG: boolean
  ) => {
    // static nodes are only present when used with compiler-dom/runtime-dom
    // which guarantees presence of hostInsertStaticContent.
    ;[n2.el, n2.anchor] = hostInsertStaticContent!(
      n2.children as string,
      container,
      anchor,
      isSVG
    )
  }

  /**
   * Dev / HMR only
   */
  const patchStaticNode = (
    n1: VNode,
    n2: VNode,
    container: RendererElement,
    isSVG: boolean
  ) => {
    // static nodes are only patched during dev for HMR
    if (n2.children !== n1.children) {
      const anchor = hostNextSibling(n1.anchor!)
      // remove existing
      removeStaticNode(n1)
      // insert new
      ;[n2.el, n2.anchor] = hostInsertStaticContent!(
        n2.children as string,
        container,
        anchor,
        isSVG
      )
    } else {
      n2.el = n1.el
      n2.anchor = n1.anchor
    }
  }

  /**
   * Dev / HMR only
   */
  const moveStaticNode = (
    vnode: VNode,
    container: RendererElement,
    anchor: RendererNode | null
  ) => {
    let cur = vnode.el
    const end = vnode.anchor!
    while (cur && cur !== end) {
      const next = hostNextSibling(cur)
      hostInsert(cur, container, anchor)
      cur = next
    }
    hostInsert(end, container, anchor)
  }

  /**
   * Dev / HMR only
   */
  const removeStaticNode = (vnode: VNode) => {
    let cur = vnode.el
    while (cur && cur !== vnode.anchor) {
      const next = hostNextSibling(cur)
      hostRemove(cur)
      cur = next
    }
    hostRemove(vnode.anchor!)
  }

  const processElement = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    isSVG = isSVG || (n2.type as string) === 'svg'
    if (n1 == null) {
      mountElement(
        n2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        optimized
      )
    } else {
      patchElement(n1, n2, parentComponent, parentSuspense, isSVG, optimized)
    }
  }

  const mountElement = (
    vnode: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    let el: RendererElement
    let vnodeHook: VNodeHook | undefined | null
    const {
      type,
      props,
      shapeFlag,
      transition,
      scopeId,
      patchFlag,
      dirs
    } = vnode
    if (
      vnode.el &&
      hostCloneNode !== undefined &&
      patchFlag === PatchFlags.HOISTED
    ) {
      // If a vnode has non-null el, it means it's being reused.
      // Only static vnodes can be reused, so its mounted DOM nodes should be
      // exactly the same, and we can simply do a clone here.
      el = vnode.el = hostCloneNode(vnode.el)
    } else {
      el = vnode.el = hostCreateElement(
        vnode.type as string,
        isSVG,
        props && props.is
      )

      // mount children first, since some props may rely on child content
      // being already rendered, e.g. `<select value>`
      if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
        hostSetElementText(el, vnode.children as string)
      } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        mountChildren(
          vnode.children as VNodeArrayChildren,
          el,
          null,
          parentComponent,
          parentSuspense,
          isSVG && type !== 'foreignObject',
          optimized || !!vnode.dynamicChildren
        )
      }

      // props
      if (props) {
        for (const key in props) {
          if (!isReservedProp(key)) {
            hostPatchProp(
              el,
              key,
              null,
              props[key],
              isSVG,
              vnode.children as VNode[],
              parentComponent,
              parentSuspense,
              unmountChildren
            )
          }
        }
        if ((vnodeHook = props.onVnodeBeforeMount)) {
          invokeVNodeHook(vnodeHook, parentComponent, vnode)
        }
      }
      if (dirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'beforeMount')
      }

      // scopeId
      if (scopeId) {
        hostSetScopeId(el, scopeId)
      }
      const treeOwnerId = parentComponent && parentComponent.type.__scopeId
      // vnode's own scopeId and the current patched component's scopeId is
      // different - this is a slot content node.
      if (treeOwnerId && treeOwnerId !== scopeId) {
        hostSetScopeId(el, treeOwnerId + '-s')
      }

      if (transition && !transition.persisted) {
        transition.beforeEnter(el)
      }
    }

    hostInsert(el, container, anchor)
    if (
      (vnodeHook = props && props.onVnodeMounted) ||
      (transition && !transition.persisted) ||
      dirs
    ) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
        transition && !transition.persisted && transition.enter(el)
        dirs && invokeDirectiveHook(vnode, null, parentComponent, 'mounted')
      }, parentSuspense)
    }
  }

  const mountChildren: MountChildrenFn = (
    children,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    optimized,
    start = 0
  ) => {
    for (let i = start; i < children.length; i++) {
      const child = (children[i] = optimized
        ? cloneIfMounted(children[i] as VNode)
        : normalizeVNode(children[i]))
      patch(
        null,
        child,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        optimized
      )
    }
  }

  const patchElement = (
    n1: VNode,
    n2: VNode,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    const el = (n2.el = n1.el!)
    let { patchFlag, dynamicChildren, dirs } = n2
    // #1426 take the old vnode's patch flag into account since user may clone a
    // compiler-generated vnode, which de-opts to FULL_PROPS
    patchFlag |= n1.patchFlag & PatchFlags.FULL_PROPS
    const oldProps = n1.props || EMPTY_OBJ
    const newProps = n2.props || EMPTY_OBJ
    let vnodeHook: VNodeHook | undefined | null

    if ((vnodeHook = newProps.onVnodeBeforeUpdate)) {
      invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
    }
    if (dirs) {
      invokeDirectiveHook(n2, n1, parentComponent, 'beforeUpdate')
    }

    if (__DEV__ && isHmrUpdating) {
      // HMR updated, force full diff
      patchFlag = 0
      optimized = false
      dynamicChildren = null
    }

    if (patchFlag > 0) {
      // the presence of a patchFlag means this element's render code was
      // generated by the compiler and can take the fast path.
      // in this path old node and new node are guaranteed to have the same shape
      // (i.e. at the exact same position in the source template)
      if (patchFlag & PatchFlags.FULL_PROPS) {
        // element props contain dynamic keys, full diff needed
        patchProps(
          el,
          n2,
          oldProps,
          newProps,
          parentComponent,
          parentSuspense,
          isSVG
        )
      } else {
        // class
        // this flag is matched when the element has dynamic class bindings.
        if (patchFlag & PatchFlags.CLASS) {
          if (oldProps.class !== newProps.class) {
            hostPatchProp(el, 'class', null, newProps.class, isSVG)
          }
        }

        // style
        // this flag is matched when the element has dynamic style bindings
        if (patchFlag & PatchFlags.STYLE) {
          hostPatchProp(el, 'style', oldProps.style, newProps.style, isSVG)
        }

        // props
        // This flag is matched when the element has dynamic prop/attr bindings
        // other than class and style. The keys of dynamic prop/attrs are saved for
        // faster iteration.
        // Note dynamic keys like :[foo]="bar" will cause this optimization to
        // bail out and go through a full diff because we need to unset the old key
        if (patchFlag & PatchFlags.PROPS) {
          // if the flag is present then dynamicProps must be non-null
          const propsToUpdate = n2.dynamicProps!
          for (let i = 0; i < propsToUpdate.length; i++) {
            const key = propsToUpdate[i]
            const prev = oldProps[key]
            const next = newProps[key]
            if (
              next !== prev ||
              (hostForcePatchProp && hostForcePatchProp(el, key))
            ) {
              hostPatchProp(
                el,
                key,
                prev,
                next,
                isSVG,
                n1.children as VNode[],
                parentComponent,
                parentSuspense,
                unmountChildren
              )
            }
          }
        }
      }

      // text
      // This flag is matched when the element has only dynamic text children.
      if (patchFlag & PatchFlags.TEXT) {
        if (n1.children !== n2.children) {
          hostSetElementText(el, n2.children as string)
        }
      }
    } else if (!optimized && dynamicChildren == null) {
      // unoptimized, full diff
      patchProps(
        el,
        n2,
        oldProps,
        newProps,
        parentComponent,
        parentSuspense,
        isSVG
      )
    }

    const areChildrenSVG = isSVG && n2.type !== 'foreignObject'
    if (dynamicChildren) {
      patchBlockChildren(
        n1.dynamicChildren!,
        dynamicChildren,
        el,
        parentComponent,
        parentSuspense,
        areChildrenSVG
      )
      if (__DEV__ && parentComponent && parentComponent.type.__hmrId) {
        traverseStaticChildren(n1, n2)
      }
    } else if (!optimized) {
      // full diff
      patchChildren(
        n1,
        n2,
        el,
        null,
        parentComponent,
        parentSuspense,
        areChildrenSVG
      )
    }

    if ((vnodeHook = newProps.onVnodeUpdated) || dirs) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, n2, n1)
        dirs && invokeDirectiveHook(n2, n1, parentComponent, 'updated')
      }, parentSuspense)
    }
  }

  // The fast path for blocks.
  const patchBlockChildren: PatchBlockChildrenFn = (
    oldChildren,
    newChildren,
    fallbackContainer,
    parentComponent,
    parentSuspense,
    isSVG
  ) => {
    for (let i = 0; i < newChildren.length; i++) {
      const oldVNode = oldChildren[i]
      const newVNode = newChildren[i]
      // Determine the container (parent element) for the patch.
      const container =
        // - In the case of a Fragment, we need to provide the actual parent
        // of the Fragment itself so it can move its children.
        oldVNode.type === Fragment ||
        // - In the case of different nodes, there is going to be a replacement
        // which also requires the correct parent container
        !isSameVNodeType(oldVNode, newVNode) ||
        // - In the case of a component, it could contain anything.
        oldVNode.shapeFlag & ShapeFlags.COMPONENT
          ? hostParentNode(oldVNode.el!)!
          : // In other cases, the parent container is not actually used so we
            // just pass the block element here to avoid a DOM parentNode call.
            fallbackContainer
      patch(
        oldVNode,
        newVNode,
        container,
        null,
        parentComponent,
        parentSuspense,
        isSVG,
        true
      )
    }
  }

  const patchProps = (
    el: RendererElement,
    vnode: VNode,
    oldProps: Data,
    newProps: Data,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean
  ) => {
    if (oldProps !== newProps) {
      for (const key in newProps) {
        if (isReservedProp(key)) continue
        const next = newProps[key]
        const prev = oldProps[key]
        if (
          next !== prev ||
          (hostForcePatchProp && hostForcePatchProp(el, key))
        ) {
          hostPatchProp(
            el,
            key,
            prev,
            next,
            isSVG,
            vnode.children as VNode[],
            parentComponent,
            parentSuspense,
            unmountChildren
          )
        }
      }
      if (oldProps !== EMPTY_OBJ) {
        for (const key in oldProps) {
          if (!isReservedProp(key) && !(key in newProps)) {
            hostPatchProp(
              el,
              key,
              oldProps[key],
              null,
              isSVG,
              vnode.children as VNode[],
              parentComponent,
              parentSuspense,
              unmountChildren
            )
          }
        }
      }
    }
  }

  const processFragment = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    const fragmentStartAnchor = (n2.el = n1 ? n1.el : hostCreateText(''))!
    const fragmentEndAnchor = (n2.anchor = n1 ? n1.anchor : hostCreateText(''))!

    let { patchFlag, dynamicChildren } = n2
    if (patchFlag > 0) {
      optimized = true
    }

    if (__DEV__ && isHmrUpdating) {
      // HMR updated, force full diff
      patchFlag = 0
      optimized = false
      dynamicChildren = null
    }

    if (n1 == null) {
      hostInsert(fragmentStartAnchor, container, anchor)
      hostInsert(fragmentEndAnchor, container, anchor)
      // a fragment can only have array children
      // since they are either generated by the compiler, or implicitly created
      // from arrays.
      mountChildren(
        n2.children as VNodeArrayChildren,
        container,
        fragmentEndAnchor,
        parentComponent,
        parentSuspense,
        isSVG,
        optimized
      )
    } else {
      if (
        patchFlag > 0 &&
        patchFlag & PatchFlags.STABLE_FRAGMENT &&
        dynamicChildren
      ) {
        // a stable fragment (template root or <template v-for>) doesn't need to
        // patch children order, but it may contain dynamicChildren.
        patchBlockChildren(
          n1.dynamicChildren!,
          dynamicChildren,
          container,
          parentComponent,
          parentSuspense,
          isSVG
        )
        if (__DEV__ && parentComponent && parentComponent.type.__hmrId) {
          traverseStaticChildren(n1, n2)
        }
      } else {
        // keyed / unkeyed, or manual fragments.
        // for keyed & unkeyed, since they are compiler generated from v-for,
        // each child is guaranteed to be a block so the fragment will never
        // have dynamicChildren.
        patchChildren(
          n1,
          n2,
          container,
          fragmentEndAnchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      }
    }
  }

  const processComponent = (
    n1: VNode | null,
    n2: VNode,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    if (n1 == null) {
      if (n2.shapeFlag & ShapeFlags.COMPONENT_KEPT_ALIVE) {
        ;(parentComponent!.ctx as KeepAliveContext).activate(
          n2,
          container,
          anchor,
          isSVG,
          optimized
        )
      } else {
        mountComponent(
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
      }
    } else {
      updateComponent(n1, n2, optimized)
    }
  }

  const mountComponent: MountComponentFn = (
    initialVNode,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    optimized
  ) => {
    const instance: ComponentInternalInstance = (initialVNode.component = createComponentInstance(
      initialVNode,
      parentComponent,
      parentSuspense
    ))

    if (__DEV__ && instance.type.__hmrId) {
      registerHMR(instance)
    }

    if (__DEV__) {
      pushWarningContext(initialVNode)
      startMeasure(instance, `mount`)
    }

    // inject renderer internals for keepAlive
    if (isKeepAlive(initialVNode)) {
      ;(instance.ctx as KeepAliveContext).renderer = internals
    }

    // resolve props and slots for setup context
    if (__DEV__) {
      startMeasure(instance, `init`)
    }
    setupComponent(instance)
    if (__DEV__) {
      endMeasure(instance, `init`)
    }

    // setup() is async. This component relies on async logic to be resolved
    // before proceeding
    if (__FEATURE_SUSPENSE__ && instance.asyncDep) {
      if (!parentSuspense) {
        if (__DEV__) warn('async setup() is used without a suspense boundary!')
        return
      }

      parentSuspense.registerDep(instance, setupRenderEffect)

      // Give it a placeholder if this is not hydration
      if (!initialVNode.el) {
        const placeholder = (instance.subTree = createVNode(Comment))
        processCommentNode(null, placeholder, container!, anchor)
      }
      return
    }

    setupRenderEffect(
      instance,
      initialVNode,
      container,
      anchor,
      parentSuspense,
      isSVG,
      optimized
    )

    if (__DEV__) {
      popWarningContext()
      endMeasure(instance, `mount`)
    }
  }

  const updateComponent = (n1: VNode, n2: VNode, optimized: boolean) => {
    const instance = (n2.component = n1.component)!
    if (shouldUpdateComponent(n1, n2, optimized)) {
      if (
        __FEATURE_SUSPENSE__ &&
        instance.asyncDep &&
        !instance.asyncResolved
      ) {
        // async & still pending - just update props and slots
        // since the component's reactive effect for render isn't set-up yet
        if (__DEV__) {
          pushWarningContext(n2)
        }
        updateComponentPreRender(instance, n2, optimized)
        if (__DEV__) {
          popWarningContext()
        }
        return
      } else {
        // normal update
        instance.next = n2
        // in case the child component is also queued, remove it to avoid
        // double updating the same child component in the same flush.
        invalidateJob(instance.update)
        // instance.update is the reactive effect runner.
        instance.update()
      }
    } else {
      // no update needed. just copy over properties
      n2.component = n1.component
      n2.el = n1.el
      instance.vnode = n2
    }
  }

  const setupRenderEffect: SetupRenderEffectFn = (
    instance,
    initialVNode,
    container,
    anchor,
    parentSuspense,
    isSVG,
    optimized
  ) => {
    // create reactive effect for rendering
    instance.update = effect(function componentEffect() {
      if (!instance.isMounted) {
        let vnodeHook: VNodeHook | null | undefined
        const { el, props } = initialVNode
        const { bm, m, a, parent } = instance
        if (__DEV__) {
          startMeasure(instance, `render`)
        }
        const subTree = (instance.subTree = renderComponentRoot(instance))
        if (__DEV__) {
          endMeasure(instance, `render`)
        }
        // beforeMount hook
        if (bm) {
          invokeArrayFns(bm)
        }
        // onVnodeBeforeMount
        if ((vnodeHook = props && props.onVnodeBeforeMount)) {
          invokeVNodeHook(vnodeHook, parent, initialVNode)
        }
        if (el && hydrateNode) {
          if (__DEV__) {
            startMeasure(instance, `hydrate`)
          }
          // vnode has adopted host node - perform hydration instead of mount.
          hydrateNode(
            initialVNode.el as Node,
            subTree,
            instance,
            parentSuspense
          )
          if (__DEV__) {
            endMeasure(instance, `hydrate`)
          }
        } else {
          if (__DEV__) {
            startMeasure(instance, `patch`)
          }
          patch(
            null,
            subTree,
            container,
            anchor,
            instance,
            parentSuspense,
            isSVG
          )
          if (__DEV__) {
            endMeasure(instance, `patch`)
          }
          initialVNode.el = subTree.el
        }
        // mounted hook
        if (m) {
          queuePostRenderEffect(m, parentSuspense)
        }
        // onVnodeMounted
        if ((vnodeHook = props && props.onVnodeMounted)) {
          queuePostRenderEffect(() => {
            invokeVNodeHook(vnodeHook!, parent, initialVNode)
          }, parentSuspense)
        }
        // activated hook for keep-alive roots.
        if (
          a &&
          initialVNode.shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
        ) {
          queuePostRenderEffect(a, parentSuspense)
        }
        instance.isMounted = true
      } else {
        // updateComponent
        // This is triggered by mutation of component's own state (next: null)
        // OR parent calling processComponent (next: VNode)
        let { next, bu, u, parent, vnode } = instance
        let originNext = next
        let vnodeHook: VNodeHook | null | undefined
        if (__DEV__) {
          pushWarningContext(next || instance.vnode)
        }

        if (next) {
          updateComponentPreRender(instance, next, optimized)
        } else {
          next = vnode
        }
        if (__DEV__) {
          startMeasure(instance, `render`)
        }
        const nextTree = renderComponentRoot(instance)
        if (__DEV__) {
          endMeasure(instance, `render`)
        }
        const prevTree = instance.subTree
        instance.subTree = nextTree
        next.el = vnode.el
        // beforeUpdate hook
        if (bu) {
          invokeArrayFns(bu)
        }
        // onVnodeBeforeUpdate
        if ((vnodeHook = next.props && next.props.onVnodeBeforeUpdate)) {
          invokeVNodeHook(vnodeHook, parent, next, vnode)
        }
        // reset refs
        // only needed if previous patch had refs
        if (instance.refs !== EMPTY_OBJ) {
          instance.refs = {}
        }
        if (__DEV__) {
          startMeasure(instance, `patch`)
        }
        patch(
          prevTree,
          nextTree,
          // parent may have changed if it's in a teleport
          hostParentNode(prevTree.el!)!,
          // anchor may have changed if it's in a fragment
          getNextHostNode(prevTree),
          instance,
          parentSuspense,
          isSVG
        )
        if (__DEV__) {
          endMeasure(instance, `patch`)
        }
        next.el = nextTree.el
        if (originNext === null) {
          // self-triggered update. In case of HOC, update parent component
          // vnode el. HOC is indicated by parent instance's subTree pointing
          // to child component's vnode
          updateHOCHostEl(instance, nextTree.el)
        }
        // updated hook
        if (u) {
          queuePostRenderEffect(u, parentSuspense)
        }
        // onVnodeUpdated
        if ((vnodeHook = next.props && next.props.onVnodeUpdated)) {
          queuePostRenderEffect(() => {
            invokeVNodeHook(vnodeHook!, parent, next!, vnode)
          }, parentSuspense)
        }
        if (__DEV__) {
          popWarningContext()
        }
      }
    }, __DEV__ ? createDevEffectOptions(instance) : prodEffectOptions)
  }

  const updateComponentPreRender = (
    instance: ComponentInternalInstance,
    nextVNode: VNode,
    optimized: boolean
  ) => {
    if (__DEV__ && instance.type.__hmrId) {
      optimized = false
    }
    nextVNode.component = instance
    const prevProps = instance.vnode.props
    instance.vnode = nextVNode
    instance.next = null
    updateProps(instance, nextVNode.props, prevProps, optimized)
    updateSlots(instance, nextVNode.children)
  }

  const patchChildren: PatchChildrenFn = (
    n1,
    n2,
    container,
    anchor,
    parentComponent,
    parentSuspense,
    isSVG,
    optimized = false
  ) => {
    const c1 = n1 && n1.children
    const prevShapeFlag = n1 ? n1.shapeFlag : 0
    const c2 = n2.children

    const { patchFlag, shapeFlag } = n2
    // fast path
    if (patchFlag > 0) {
      if (patchFlag & PatchFlags.KEYED_FRAGMENT) {
        // this could be either fully-keyed or mixed (some keyed some not)
        // presence of patchFlag means children are guaranteed to be arrays
        patchKeyedChildren(
          c1 as VNode[],
          c2 as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
        return
      } else if (patchFlag & PatchFlags.UNKEYED_FRAGMENT) {
        // unkeyed
        patchUnkeyedChildren(
          c1 as VNode[],
          c2 as VNodeArrayChildren,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
        return
      }
    }

    // children has 3 possibilities: text, array or no children.
    if (shapeFlag & ShapeFlags.TEXT_CHILDREN) {
      // text children fast path
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        unmountChildren(c1 as VNode[], parentComponent, parentSuspense)
      }
      if (c2 !== c1) {
        hostSetElementText(container, c2 as string)
      }
    } else {
      if (prevShapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        // prev children was array
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          // two arrays, cannot assume anything, do full diff
          patchKeyedChildren(
            c1 as VNode[],
            c2 as VNodeArrayChildren,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
          )
        } else {
          // no new children, just unmount old
          unmountChildren(c1 as VNode[], parentComponent, parentSuspense, true)
        }
      } else {
        // prev children was text OR null
        // new children is array OR null
        if (prevShapeFlag & ShapeFlags.TEXT_CHILDREN) {
          hostSetElementText(container, '')
        }
        // mount new if array
        if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
          mountChildren(
            c2 as VNodeArrayChildren,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
          )
        }
      }
    }
  }

  const patchUnkeyedChildren = (
    c1: VNode[],
    c2: VNodeArrayChildren,
    container: RendererElement,
    anchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    c1 = c1 || EMPTY_ARR
    c2 = c2 || EMPTY_ARR
    const oldLength = c1.length
    const newLength = c2.length
    const commonLength = Math.min(oldLength, newLength)
    let i
    for (i = 0; i < commonLength; i++) {
      const nextChild = (c2[i] = optimized
        ? cloneIfMounted(c2[i] as VNode)
        : normalizeVNode(c2[i]))
      patch(
        c1[i],
        nextChild,
        container,
        null,
        parentComponent,
        parentSuspense,
        isSVG,
        optimized
      )
    }
    if (oldLength > newLength) {
      // remove old
      unmountChildren(c1, parentComponent, parentSuspense, true, commonLength)
    } else {
      // mount new
      mountChildren(
        c2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        isSVG,
        optimized,
        commonLength
      )
    }
  }

  // can be all-keyed or mixed
  const patchKeyedChildren = (
    c1: VNode[],
    c2: VNodeArrayChildren,
    container: RendererElement,
    parentAnchor: RendererNode | null,
    parentComponent: ComponentInternalInstance | null,
    parentSuspense: SuspenseBoundary | null,
    isSVG: boolean,
    optimized: boolean
  ) => {
    let i = 0
    const l2 = c2.length
    let e1 = c1.length - 1 // prev ending index
    let e2 = l2 - 1 // next ending index

    // 1. sync from start
    // (a b) c
    // (a b) d e
    while (i <= e1 && i <= e2) {
      const n1 = c1[i]
      const n2 = (c2[i] = optimized
        ? cloneIfMounted(c2[i] as VNode)
        : normalizeVNode(c2[i]))
      if (isSameVNodeType(n1, n2)) {
        patch(
          n1,
          n2,
          container,
          null,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
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
      const n2 = (c2[e2] = optimized
        ? cloneIfMounted(c2[e2] as VNode)
        : normalizeVNode(c2[e2]))
      if (isSameVNodeType(n1, n2)) {
        patch(
          n1,
          n2,
          container,
          null,
          parentComponent,
          parentSuspense,
          isSVG,
          optimized
        )
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
          patch(
            null,
            (c2[i] = optimized
              ? cloneIfMounted(c2[i] as VNode)
              : normalizeVNode(c2[i])),
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG
          )
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
        unmount(c1[i], parentComponent, parentSuspense, true)
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
      const keyToNewIndexMap: Map<string | number, number> = new Map()
      for (i = s2; i <= e2; i++) {
        const nextChild = (c2[i] = optimized
          ? cloneIfMounted(c2[i] as VNode)
          : normalizeVNode(c2[i]))
        if (nextChild.key != null) {
          if (__DEV__ && keyToNewIndexMap.has(nextChild.key)) {
            warn(
              `Duplicate keys found during update:`,
              JSON.stringify(nextChild.key),
              `Make sure keys are unique.`
            )
          }
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
      const newIndexToOldIndexMap = new Array(toBePatched)
      for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0

      for (i = s1; i <= e1; i++) {
        const prevChild = c1[i]
        if (patched >= toBePatched) {
          // all new children have been patched so this can only be a removal
          unmount(prevChild, parentComponent, parentSuspense, true)
          continue
        }
        let newIndex
        if (prevChild.key != null) {
          newIndex = keyToNewIndexMap.get(prevChild.key)
        } else {
          // key-less node, try to locate a key-less node of the same type
          for (j = s2; j <= e2; j++) {
            if (
              newIndexToOldIndexMap[j - s2] === 0 &&
              isSameVNodeType(prevChild, c2[j] as VNode)
            ) {
              newIndex = j
              break
            }
          }
        }
        if (newIndex === undefined) {
          unmount(prevChild, parentComponent, parentSuspense, true)
        } else {
          newIndexToOldIndexMap[newIndex - s2] = i + 1
          if (newIndex >= maxNewIndexSoFar) {
            maxNewIndexSoFar = newIndex
          } else {
            moved = true
          }
          patch(
            prevChild,
            c2[newIndex] as VNode,
            container,
            null,
            parentComponent,
            parentSuspense,
            isSVG,
            optimized
          )
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
          patch(
            null,
            nextChild,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            isSVG
          )
        } else if (moved) {
          // move if:
          // There is no stable subsequence (e.g. a reverse)
          // OR current node is not among the stable sequence
          if (j < 0 || i !== increasingNewIndexSequence[j]) {
            move(nextChild, container, anchor, MoveType.REORDER)
          } else {
            j--
          }
        }
      }
    }
  }

  const move: MoveFn = (
    vnode,
    container,
    anchor,
    moveType,
    parentSuspense = null
  ) => {
    const { el, type, transition, children, shapeFlag } = vnode
    if (shapeFlag & ShapeFlags.COMPONENT) {
      move(vnode.component!.subTree, container, anchor, moveType)
      return
    }

    if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
      vnode.suspense!.move(container, anchor, moveType)
      return
    }

    if (shapeFlag & ShapeFlags.TELEPORT) {
      ;(type as typeof TeleportImpl).move(vnode, container, anchor, internals)
      return
    }

    if (type === Fragment) {
      hostInsert(el!, container, anchor)
      for (let i = 0; i < (children as VNode[]).length; i++) {
        move((children as VNode[])[i], container, anchor, moveType)
      }
      hostInsert(vnode.anchor!, container, anchor)
      return
    }

    // static node move can only happen when force updating HMR
    if (__DEV__ && type === Static) {
      moveStaticNode(vnode, container, anchor)
      return
    }

    // single nodes
    const needTransition =
      moveType !== MoveType.REORDER &&
      shapeFlag & ShapeFlags.ELEMENT &&
      transition
    if (needTransition) {
      if (moveType === MoveType.ENTER) {
        transition!.beforeEnter(el!)
        hostInsert(el!, container, anchor)
        queuePostRenderEffect(() => transition!.enter(el!), parentSuspense)
      } else {
        const { leave, delayLeave, afterLeave } = transition!
        const remove = () => hostInsert(el!, container, anchor)
        const performLeave = () => {
          leave(el!, () => {
            remove()
            afterLeave && afterLeave()
          })
        }
        if (delayLeave) {
          delayLeave(el!, remove, performLeave)
        } else {
          performLeave()
        }
      }
    } else {
      hostInsert(el!, container, anchor)
    }
  }

  const unmount: UnmountFn = (
    vnode,
    parentComponent,
    parentSuspense,
    doRemove = false
  ) => {
    const {
      type,
      props,
      ref,
      children,
      dynamicChildren,
      shapeFlag,
      patchFlag,
      dirs
    } = vnode
    const shouldInvokeDirs = shapeFlag & ShapeFlags.ELEMENT && dirs
    const shouldKeepAlive = shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
    let vnodeHook: VNodeHook | undefined | null

    // unset ref
    if (ref != null && parentComponent) {
      setRef(ref, null, parentComponent, null)
    }

    if ((vnodeHook = props && props.onVnodeBeforeUnmount) && !shouldKeepAlive) {
      invokeVNodeHook(vnodeHook, parentComponent, vnode)
    }

    if (shapeFlag & ShapeFlags.COMPONENT) {
      if (shouldKeepAlive) {
        ;(parentComponent!.ctx as KeepAliveContext).deactivate(vnode)
      } else {
        unmountComponent(vnode.component!, parentSuspense, doRemove)
      }
    } else {
      if (__FEATURE_SUSPENSE__ && shapeFlag & ShapeFlags.SUSPENSE) {
        vnode.suspense!.unmount(parentSuspense, doRemove)
        return
      }

      if (shouldInvokeDirs) {
        invokeDirectiveHook(vnode, null, parentComponent, 'beforeUnmount')
      }

      if (
        dynamicChildren &&
        // #1153: fast path should not be taken for non-stable (v-for) fragments
        (type !== Fragment ||
          (patchFlag > 0 && patchFlag & PatchFlags.STABLE_FRAGMENT))
      ) {
        // fast path for block nodes: only need to unmount dynamic children.
        unmountChildren(dynamicChildren, parentComponent, parentSuspense)
      } else if (shapeFlag & ShapeFlags.ARRAY_CHILDREN) {
        unmountChildren(children as VNode[], parentComponent, parentSuspense)
      }

      // an unmounted teleport should always remove its children
      if (shapeFlag & ShapeFlags.TELEPORT) {
        ;(vnode.type as typeof TeleportImpl).remove(vnode, internals)
      }

      if (doRemove) {
        remove(vnode)
      }
    }

    if (
      ((vnodeHook = props && props.onVnodeUnmounted) || shouldInvokeDirs) &&
      !shouldKeepAlive
    ) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode)
        shouldInvokeDirs &&
          invokeDirectiveHook(vnode, null, parentComponent, 'unmounted')
      }, parentSuspense)
    }
  }

  const remove: RemoveFn = vnode => {
    const { type, el, anchor, transition } = vnode
    if (type === Fragment) {
      removeFragment(el!, anchor!)
      return
    }

    if (__DEV__ && type === Static) {
      removeStaticNode(vnode)
      return
    }

    const performRemove = () => {
      hostRemove(el!)
      if (transition && !transition.persisted && transition.afterLeave) {
        transition.afterLeave()
      }
    }

    if (
      vnode.shapeFlag & ShapeFlags.ELEMENT &&
      transition &&
      !transition.persisted
    ) {
      const { leave, delayLeave } = transition
      const performLeave = () => leave(el!, performRemove)
      if (delayLeave) {
        delayLeave(vnode.el!, performRemove, performLeave)
      } else {
        performLeave()
      }
    } else {
      performRemove()
    }
  }

  const removeFragment = (cur: RendererNode, end: RendererNode) => {
    // For fragments, directly remove all contained DOM nodes.
    // (fragment child nodes cannot have transition)
    let next
    while (cur !== end) {
      next = hostNextSibling(cur)!
      hostRemove(cur)
      cur = next
    }
    hostRemove(end)
  }

  const unmountComponent = (
    instance: ComponentInternalInstance,
    parentSuspense: SuspenseBoundary | null,
    doRemove?: boolean
  ) => {
    if (__DEV__ && instance.type.__hmrId) {
      unregisterHMR(instance)
    }

    const { bum, effects, update, subTree, um, da, isDeactivated } = instance
    // beforeUnmount hook
    if (bum) {
      invokeArrayFns(bum)
    }
    if (effects) {
      for (let i = 0; i < effects.length; i++) {
        stop(effects[i])
      }
    }
    // update may be null if a component is unmounted before its async
    // setup has resolved.
    if (update) {
      stop(update)
      unmount(subTree, instance, parentSuspense, doRemove)
    }
    // unmounted hook
    if (um) {
      queuePostRenderEffect(um, parentSuspense)
    }
    // deactivated hook
    if (
      da &&
      !isDeactivated &&
      instance.vnode.shapeFlag & ShapeFlags.COMPONENT_SHOULD_KEEP_ALIVE
    ) {
      queuePostRenderEffect(da, parentSuspense)
    }
    queuePostRenderEffect(() => {
      instance.isUnmounted = true
    }, parentSuspense)

    // A component with async dep inside a pending suspense is unmounted before
    // its async dep resolves. This should remove the dep from the suspense, and
    // cause the suspense to resolve immediately if that was the last dep.
    if (
      __FEATURE_SUSPENSE__ &&
      parentSuspense &&
      !parentSuspense.isResolved &&
      !parentSuspense.isUnmounted &&
      instance.asyncDep &&
      !instance.asyncResolved
    ) {
      parentSuspense.deps--
      if (parentSuspense.deps === 0) {
        parentSuspense.resolve()
      }
    }
  }

  const unmountChildren: UnmountChildrenFn = (
    children,
    parentComponent,
    parentSuspense,
    doRemove = false,
    start = 0
  ) => {
    for (let i = start; i < children.length; i++) {
      unmount(children[i], parentComponent, parentSuspense, doRemove)
    }
  }

  const getNextHostNode: NextFn = vnode => {
    if (vnode.shapeFlag & ShapeFlags.COMPONENT) {
      return getNextHostNode(vnode.component!.subTree)
    }
    if (__FEATURE_SUSPENSE__ && vnode.shapeFlag & ShapeFlags.SUSPENSE) {
      return vnode.suspense!.next()
    }
    return hostNextSibling((vnode.anchor || vnode.el)!)
  }

  /**
   * #1156
   * When a component is HMR-enabled, we need to make sure that all static nodes
   * inside a block also inherit the DOM element from the previous tree so that
   * HMR updates (which are full updates) can retrieve the element for patching.
   *
   * Dev only.
   */
  const traverseStaticChildren = (n1: VNode, n2: VNode) => {
    const ch1 = n1.children
    const ch2 = n2.children
    if (isArray(ch1) && isArray(ch2)) {
      for (let i = 0; i < ch1.length; i++) {
        const c1 = ch1[i]
        const c2 = ch2[i]
        if (
          isVNode(c1) &&
          isVNode(c2) &&
          c2.shapeFlag & ShapeFlags.ELEMENT &&
          !c2.dynamicChildren
        ) {
          if (c2.patchFlag <= 0) {
            c2.el = c1.el
          }
          traverseStaticChildren(c1, c2)
        }
      }
    }
  }

  const render: RootRenderFunction = (vnode, container) => {
    if (vnode == null) {
      if (container._vnode) {
        unmount(container._vnode, null, null, true)
      }
    } else {
      patch(container._vnode || null, vnode, container)
    }
    flushPostFlushCbs()
    container._vnode = vnode
  }

  const internals: RendererInternals = {
    p: patch,
    um: unmount,
    m: move,
    r: remove,
    mt: mountComponent,
    mc: mountChildren,
    pc: patchChildren,
    pbc: patchBlockChildren,
    n: getNextHostNode,
    o: options
  }

  let hydrate: ReturnType<typeof createHydrationFunctions>[0] | undefined
  let hydrateNode: ReturnType<typeof createHydrationFunctions>[1] | undefined
  if (createHydrationFns) {
    ;[hydrate, hydrateNode] = createHydrationFns(internals as RendererInternals<
      Node,
      Element
    >)
  }

  return {
    render,
    hydrate,
    createApp: createAppAPI(render, hydrate)
  }
}

export function invokeVNodeHook(
  hook: VNodeHook,
  instance: ComponentInternalInstance | null,
  vnode: VNode,
  prevVNode: VNode | null = null
) {
  callWithAsyncErrorHandling(hook, instance, ErrorCodes.VNODE_HOOK, [
    vnode,
    prevVNode
  ])
}

// https://en.wikipedia.org/wiki/Longest_increasing_subsequence
function getSequence(arr: number[]): number[] {
  const p = arr.slice()
  const result = [0]
  let i, j, u, v, c
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
