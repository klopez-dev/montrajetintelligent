import type { FeedMetadata, GtfsDirection, GtfsLine, GtfsStop, PassageResult } from '../types/gtfs.ts'
import type { ServiceResult } from '../types/transport.ts'

async function request<T>(path: string, parameters: Record<string, string> = {}, signal?: AbortSignal): Promise<ServiceResult<T>> {
  try {
    const response = await fetch(`/api/gtfs/${path}?${new URLSearchParams(parameters)}`, { signal, headers: { Accept: 'application/json' } })
    const payload = await response.json()
    if (response.ok && payload.status === 'connected' && payload.data !== undefined) return { status: 'connected', data: payload.data as T }
    return { status: 'disconnected', message: payload.message || payload.error || 'Les données GTFS ne sont pas disponibles.' }
  } catch (error) {
    if (signal?.aborted) throw error
    return { status: 'disconnected', message: 'Impossible de joindre les données GTFS. Vérifiez que le serveur et la base importée sont disponibles.' }
  }
}

export const gtfsApi = {
  status: (signal?: AbortSignal) => request<FeedMetadata>('status', {}, signal),
  searchLines: (q: string, signal?: AbortSignal) => request<GtfsLine[]>('lines', { q }, signal),
  searchStops: (q: string, lineId = '', signal?: AbortSignal) => request<GtfsStop[]>('stops', { q, lineId }, signal),
  directions: (lineId: string, stopId: string, signal?: AbortSignal) => request<GtfsDirection[]>('directions', { lineId, stopId }, signal),
  passages: (lineId: string, stopId: string, at?: string, signal?: AbortSignal) => request<PassageResult>('passages', { lineId, stopId, ...(at ? { at } : {}) }, signal),
}
