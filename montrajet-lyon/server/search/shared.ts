import type { ProgressObserver, SearchProgress } from '../../src/types/searchProgress.ts'

interface Subscriber { observer?: ProgressObserver }
interface Job<T> { controller: AbortController; subscribers: Set<Subscriber>; promise: Promise<T>; last?: SearchProgress }
/** In-flight only, scoped by the API to one immutable DB binding. No address log. */
export function createSharedSearch<T>(capacity = 8) {
  const jobs = new Map<string, Job<T>>()
  return {
    has: (key: string) => jobs.has(key),
    run(key: string, work: (signal: AbortSignal, observer: ProgressObserver) => Promise<T>, signal: AbortSignal, observer?: ProgressObserver): Promise<T> {
      signal.throwIfAborted()
      let job = jobs.get(key)
      if (!job) {
        if (jobs.size >= capacity) return Promise.reject(new Error('Le calculateur est occupé. Réessayez dans un instant.'))
        const created: Job<T> = { controller: new AbortController(), subscribers: new Set(), promise: Promise.resolve(undefined as T) }
        const cleanup = () => { if (jobs.get(key) === created) jobs.delete(key) }
        created.promise = Promise.resolve().then(() => {
          created.controller.signal.throwIfAborted()
          return work(created.controller.signal, event => {
            created.last = event
            for (const subscriber of created.subscribers) { try { subscriber.observer?.(event) } catch { /* A disconnected listener cannot corrupt a shared result. */ } }
          })
        }).then(value => { cleanup(); return value }, error => { cleanup(); throw error })
        jobs.set(key, created); job = created
      }
      const entry = job, subscriber = { observer }
      entry.subscribers.add(subscriber)
      if (entry.last) observer?.(entry.last)
      return new Promise<T>((resolve, reject) => {
        let detached = false
        const detach = () => { if (detached) return; detached = true; signal.removeEventListener('abort', abort); entry.subscribers.delete(subscriber) }
        const abort = () => {
          detach(); reject(signal.reason)
          if (!entry.subscribers.size) { entry.controller.abort(); if (jobs.get(key) === entry) jobs.delete(key) }
        }
        signal.addEventListener('abort', abort, { once: true })
        entry.promise.then(value => { if (!detached) { detach(); resolve(value) } }, error => { if (!detached) { detach(); reject(error) } })
        if (signal.aborted) abort()
      })
    },
  }
}
