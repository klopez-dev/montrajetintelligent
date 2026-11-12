import { searchStageLabels } from '../types/searchProgress.ts'
import type { ProgressObserver, SearchStage } from '../types/searchProgress.ts'
import type { ServiceResult } from '../types/transport.ts'

export async function readSearchResponse<T>(response: Response, signal?: AbortSignal, progress?: ProgressObserver): Promise<ServiceResult<T>> {
  if (!response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
    const body = await response.json()
    return response.ok && body.status === 'connected' ? body : { status: 'disconnected', message: body.error || 'Calculateur indisponible.' }
  }
  if (!response.body) throw new Error('Flux de calcul absent.')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let pending = '', terminal: ServiceResult<T> | undefined, bytes = 0
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      signal?.throwIfAborted()
      const { done, value } = await reader.read()
      signal?.throwIfAborted()
      bytes += value?.length || 0
      if (bytes > 5000000) throw new Error('Réponse de calcul trop volumineuse.')
      pending += decoder.decode(value, { stream: !done })
      let index: number
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1)
        if (!line.trim()) continue
        const event = JSON.parse(line)
        if (terminal) throw new Error('Événement après la fin du calcul.')
        if (event.type === 'stage' && typeof event.stage === 'string' && Object.hasOwn(searchStageLabels, event.stage) && typeof event.at === 'string') progress?.({ stage: event.stage as SearchStage, at: event.at })
        else if (event.type === 'result' && event.value?.status === 'connected' && event.value.data !== undefined) terminal = event.value as ServiceResult<T>
        else if (event.type === 'error' && typeof event.message === 'string') terminal = { status: 'disconnected', message: event.message }
        else throw new Error('Événement de calcul invalide.')
      }
      if (done) break
    }
    if (!terminal || pending.trim()) throw new Error('Flux de calcul interrompu ou incomplet.')
    return terminal
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock() }
}
