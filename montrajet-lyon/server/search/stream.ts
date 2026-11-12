import type { ProgressObserver } from '../../src/types/searchProgress.ts'

export function wantsSearchStream(request: Request) { return request.headers.get('Accept')?.includes('application/x-ndjson') === true }
export function searchStream(request: Request, operation: (signal: AbortSignal, observer: ProgressObserver) => Promise<Response>): Response {
  const controller = new AbortController(), encoder = new TextEncoder()
  const signal = AbortSignal.any([request.signal, controller.signal])
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      const abort = () => stream.error(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      const send = (data: unknown) => { if (!signal.aborted) stream.enqueue(encoder.encode(JSON.stringify(data) + '\n')) }
      void (async () => {
      try {
        const response = await operation(signal, event => send({ type: 'stage', ...event }))
        signal.throwIfAborted()
        const value = await response.json()
        if (response.ok) send({ type: 'result', value })
        else send({ type: 'error', message: value.error || 'Calculateur indisponible.' })
      } catch { if (!signal.aborted) send({ type: 'error', message: 'Le calculateur est indisponible ou le délai est dépassé.' }) }
      finally { signal.removeEventListener('abort', abort); if (!signal.aborted) stream.close() }
      })()
    },
    cancel() { controller.abort() },
  })
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } })
}
