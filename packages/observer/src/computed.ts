import { autorun, stop } from './index'
import { Autorun, activeAutorunStack } from './autorun'

export interface ComputedGetter {
  (): any
  stop: () => void
}

export function computed(getter: Function, context?: any): ComputedGetter {
  let dirty: boolean = true
  let value: any = undefined
  const runner = autorun(() => getter.call(context, context), {
    lazy: true,
    scheduler: () => {
      dirty = true
    }
  })
  // mark runner as computed so that it gets priority during trigger
  runner.computed = true
  const computedGetter = (() => {
    if (dirty) {
      value = runner()
      dirty = false
    }
    // When computed autoruns are accessed in a parent autorun, the parent
    // should track all the dependencies the computed property has tracked.
    // This should also apply for chained computed properties.
    trackChildRun(runner)
    return value
  }) as ComputedGetter
  computedGetter.stop = () => stop(runner)
  return computedGetter
}

function trackChildRun(childRunner: Autorun) {
  const parentRunner = activeAutorunStack[activeAutorunStack.length - 1]
  if (parentRunner) {
    for (let i = 0; i < childRunner.deps.length; i++) {
      const dep = childRunner.deps[i]
      if (!dep.has(parentRunner)) {
        dep.add(parentRunner)
        parentRunner.deps.push(dep)
      }
    }
  }
}
