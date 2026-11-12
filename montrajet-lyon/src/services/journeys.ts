import { readSearchResponse } from './searchStream.ts'
import type { ProgressObserver } from '../types/searchProgress'
import type { JourneyStop, RoutingQuery, RoutingResult } from '../types/journey.ts'
import type { ServiceResult } from '../types/transport.ts'

async function request<T>(path: string, params: Record<string, string>, signal?: AbortSignal, progress?: ProgressObserver): Promise<ServiceResult<T>> {
  try {
    const response = await fetch(`/api/journeys/${path}?${new URLSearchParams(params)}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000), headers: { Accept: path === 'search' ? 'application/x-ndjson' : 'application/json' } })
    return await readSearchResponse<T>(response, signal, progress)
  } catch (error) {
    if (signal?.aborted) throw error
    return { status: 'disconnected', message: 'Impossible de joindre le calculateur. Aucun résultat de remplacement n’a été inventé.' }
  }
}
export const journeysApi = {
  searchStops: (q: string, signal: AbortSignal) => request<JourneyStop[]>('stops', { q }, signal),
  stopById: (id: string, signal: AbortSignal) => request<JourneyStop[]>('stops', { id }, signal),
  search: (query: RoutingQuery, signal?: AbortSignal, progress?: ProgressObserver) => request<RoutingResult>('search', { ...query, marginSeconds: String(query.marginSeconds), maxTransfers: String(query.maxTransfers ?? 2) }, signal, progress),
}
