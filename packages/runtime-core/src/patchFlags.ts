// Patch flags are optimization hints generated by the compiler.
// when a block with dynamicChildren is encountered during diff, the algorithm
// enters "optimized mode". In this mode, we know that the vdom is produced by
// a render function generated by the compiler, so the algorithm only needs to
// handle updates explicitly marked by these patch flags.

// Patch flags can be combined using the | bitwise operator and can be checked
// using the & operator, e.g.
//
//   const flag = TEXT | CLASS
//   if (flag & TEXT) { ... }
//
// Check the `patchElement` function in './createRednerer.ts' to see how the
// flags are handled during diff.

// Indicates an element with dynamic textContent (children fast path)
export const TEXT = 1

// Indicates an element with dynamic class
export const CLASS = 1 << 1

// Indicates an element with dynamic style
export const STYLE = 1 << 2

// Indicates an element that has non-class/style dynamic props.
// Can also be on a component that has any dynamic props (includes class/style).
// when this flag is present, the vnode also has a dynamicProps array that
// contains the keys of the props that may change so the runtime can diff
// them faster (without having to worry about removed props)
export const PROPS = 1 << 3

// Indicates an element with props with dynamic keys. When keys change, a full
// diff is always needed to remove the old key. This flag is mutually exclusive
// with CLASS, STYLE and PROPS.
export const FULL_PROPS = 1 << 4

// Indicates a fragment or element with keyed or partially-keyed v-for children
export const KEYED = 1 << 5

// Indicates a fragment or element that contains unkeyed v-for children
export const UNKEYED = 1 << 6

// Indicates a component with dynamic slots (e.g. slot that references a v-for
// iterated value, or dynamic slot names).
// Components with this flag are always force updated.
export const DYNAMIC_SLOTS = 1 << 7
