import type { TrafficSnapshot, JourneyTrafficNotice } from '../types/traffic.ts'
import type { TheoreticalJourney } from '../types/journey.ts'

export interface JourneyTrafficResponse extends TrafficSnapshot { notices: JourneyTrafficNotice[][]; matchingUnavailable?: boolean }
export async function trafficRequest<T = TrafficSnapshot>(params: Record<string, string>, signal: AbortSignal, journeys?: TheoreticalJourney[]): Promise<T> {
  let response: Response
  let body: { status?: string; data?: T; error?: string }
  try {
    response = await fetch('/api/traffic' + (journeys ? '/journeys' : '') + '?' + new URLSearchParams(params), { method: journeys ? 'POST' : 'GET', headers: { Accept: 'application/json', ...(journeys ? { 'Content-Type': 'application/json' } : {}) }, signal: AbortSignal.any([signal, AbortSignal.timeout(55000)]), ...(journeys ? { body: JSON.stringify({ journeys: journeys.map(j => j.legs.map(l => ({ tripId: l.tripId, serviceDate: l.serviceDate, from: l.from, to: l.to }))) }) } : {}) })
    body = await response.json()
  } catch (error) { if (signal.aborted) throw error; throw new Error('Connexion au service trafic TCL indisponible ou réponse invalide.') }
  if (!response.ok || body.status !== 'connected' || body.data === undefined) throw new Error(body.error || 'Service trafic TCL indisponible.')
  return body.data
}
