const listeners = new Map()

export function useEventBus() {
  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(fn)
    return () => listeners.get(event)?.delete(fn)
  }

  function emit(event, ...args) {
    listeners.get(event)?.forEach(fn => fn(...args))
  }

  return { on, emit }
}
