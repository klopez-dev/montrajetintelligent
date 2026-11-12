import { readSearchResponse } from './searchStream'
import type { ProgressObserver } from '../types/searchProgress'
import { journeysApi } from './journeys'
import type { AddressPlace, JourneyPlace, MobilityQuery, MobilityResult } from '../types/mobility'
import type { ServiceResult } from '../types/transport'

async function addresses(q: string, signal: AbortSignal): Promise<ServiceResult<AddressPlace[]>> {
  try {
    const response = await fetch('/api/mobility/addresses?' + new URLSearchParams({ q }), { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) })
    const body = await response.json()
    return response.ok && body.status === 'connected' ? body : { status: 'disconnected', message: body.error || 'Recherche d’adresses indisponible.' }
  } catch (error) {
    if (signal.aborted) throw error
    return { status: 'disconnected', message: 'Recherche d’adresses IGN indisponible ; les arrêts TCL restent recherchables.' }
  }
}
export const mobilityApi = {
  searchAddresses: addresses,
  async searchPlaces(q: string, signal: AbortSignal): Promise<ServiceResult<JourneyPlace[]>> {
    const [stops, places] = await Promise.all([journeysApi.searchStops(q, signal), q.length >= 3 ? addresses(q, signal) : Promise.resolve({ status: 'connected' as const, data: [] })])
    const data: JourneyPlace[] = [...(stops.status === 'connected' ? stops.data : []), ...(places.status === 'connected' ? places.data : [])]
    const warning = [stops.status === 'disconnected' ? stops.message : '', places.status === 'disconnected' ? places.message : ''].filter(Boolean).join(' ')
    return { status: 'connected', data, warning }
  },
  async search(query: MobilityQuery, signal: AbortSignal, progress?: ProgressObserver): Promise<ServiceResult<MobilityResult>> {
    try {
      const response = await fetch('/api/mobility/search', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify(query), signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]) })
      return await readSearchResponse<MobilityResult>(response, signal, progress)
    } catch (error) {
      if (signal.aborted) throw error
      return { status: 'disconnected', message: 'Calcul porte-à-porte indisponible ou délai dépassé. Aucun trajet piéton de remplacement n’a été inventé.' }
    }
  },
}
