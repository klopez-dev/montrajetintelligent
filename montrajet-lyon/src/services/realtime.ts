import type { RealtimeEstimate, RealtimeResult } from '../types/realtime.ts'
import type { TheoreticalPassage } from '../types/gtfs.ts'

export function withoutCoveredTrips(passages: TheoreticalPassage[], liveTripIds: string[]): TheoreticalPassage[] {
  const covered = new Set(liveTripIds)
  return passages.filter(passage => !covered.has(passage.tripId))
}

export function currentEstimates(estimates: RealtimeEstimate[], now: number) {
  return estimates.filter(row => ['estimated', 'theoretical'].includes(row.kind) && Date.parse(row.estimatedTime) > now && Date.parse(row.validUntil) > now)
}

/** Une panne réseau ou un cache d'isolate plus ancien n'écrase pas une estimation
 * encore fraîche déjà reçue par cette page. Sa date d'expiration n'est jamais prolongée.
 */
export function preferFreshResult(previous: RealtimeResult | null, incoming: RealtimeResult, now: number): RealtimeResult {
  const old = previous ? currentEstimates(previous.estimates, now) : []
  if (!old.length) return incoming
  if (incoming.state === 'unavailable' || incoming.state === 'stale') return {
    ...previous!, checkedAt: incoming.checkedAt, state: 'available', estimates: old, reason: 'retained_fresh',
    message: 'La nouvelle consultation est indisponible. Les dernières estimations encore fraîches sont conservées jusqu’à expiration.',
  }
  if (incoming.state !== 'available') return incoming
  const key = (row: RealtimeEstimate) => JSON.stringify([row.tripId, row.lineId, row.stopId, row.directionId])
  const oldRows = new Map(old.map(row => [key(row), row]))
  const estimates = incoming.estimates.map(row => {
    const existing = oldRows.get(key(row))
    if (!currentEstimates([row], now).length) return existing || null
    return existing && Date.parse(existing.sourceUpdatedAt) > Date.parse(row.sourceUpdatedAt) ? existing : row
  }).filter((row): row is RealtimeEstimate => row !== null)
  if (!estimates.length) return preferFreshResult(previous, { ...incoming, state: 'stale' }, now)
  return { ...incoming, estimates, sourceUpdatedAt: estimates.map(row => row.sourceUpdatedAt).sort().at(-1) || null }
}
function validEstimate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return ['estimated', 'theoretical'].includes(String(row.kind)) && ['tripId', 'lineId', 'stopId', 'directionId', 'headsign'].every(key => typeof row[key] === 'string') &&
    ['estimatedTime', 'sourceUpdatedAt', 'validUntil'].every(key => typeof row[key] === 'string' && Number.isFinite(Date.parse(row[key] as string)))
}
function timestamp(value: unknown): boolean {
  return value === null || typeof value === 'string' && Number.isFinite(Date.parse(value))
}
export async function fetchRealtime(lineId: string, stopId: string, signal: AbortSignal): Promise<RealtimeResult> {
  try {
    const response = await fetch(`/api/realtime/passages?${new URLSearchParams({ lineId, stopId })}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]), headers: { Accept: 'application/json' },
    })
    const payload = await response.json()
    if (response.ok && payload && Array.isArray(payload.estimates) && payload.estimates.every(validEstimate) &&
      typeof payload.message === 'string' && typeof payload.reason === 'string' && timestamp(payload.sourceUpdatedAt) && timestamp(payload.fetchedAt) &&
      ['available', 'unavailable', 'no_estimates', 'stale'].includes(payload.state)) return payload as RealtimeResult
  } catch (error) { if (signal.aborted) throw error }
  return { state: 'unavailable', reason: 'backend_unavailable', checkedAt: new Date().toISOString(), fetchedAt: null, sourceUpdatedAt: null, estimates: [], mapping: null,
    message: 'Les estimations ne peuvent pas être consultées. Les horaires théoriques GTFS restent disponibles.' }
}
