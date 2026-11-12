import type { QueryDatabase } from '../gtfs/repository.ts'
import { addDays, localServiceDate, normalizeSearch, serviceDayOrigin } from '../gtfs/time.ts'
import type { MappingStatistics, RealtimeEstimate } from '../../src/types/realtime.ts'
import { providerInstant } from './time.ts'

export interface ProviderRow {
  id: string
  ligne: string
  direction: string
  type: 'E' | 'T'
  heurepassage: string
  idtarretdestination: string
  coursetheorique: string
  gid: string
  last_update_fme: string
}
function id(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() && value.length <= 200) return value.trim()
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : null
}

export function parseProviderRow(raw: unknown): ProviderRow | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const result = {
    id: id(row.id), ligne: id(row.ligne), direction: id(row.direction),
    type: row.type, heurepassage: id(row.heurepassage), idtarretdestination: id(row.idtarretdestination),
    coursetheorique: id(row.coursetheorique), gid: id(row.gid), last_update_fme: id(row.last_update_fme),
  }
  if (!result.id || !result.ligne || !result.direction || !['E', 'T'].includes(String(result.type)) || !result.heurepassage || !result.idtarretdestination || !result.coursetheorique || !result.gid || !result.last_update_fme) return null
  return result as ProviderRow
}

/** Contrat préparé, DÉSACTIVÉ tant qu'un échantillon autorisé ne l'a pas confirmé.
 * id = stop_id exact ; course = trip_id exact ; ligne = route_id exact ; destination
 * doit être un arrêt ultérieur de cette même course. Aucun retrait de suffixe,
 * aucun usage de gid comme arrêt, aucun rapprochement par nom.
 */
export async function mapEstimates(db: QueryDatabase, input: unknown[], lineId: string, stopId: string, now: number, maxAgeMs: number): Promise<{ estimates: RealtimeEstimate[]; statistics: MappingStatistics }> {
  const statistics: MappingStatistics = { received: input.length, matched: 0, rejected: 0, matchRate: null, reasons: {} }
  const estimates: RealtimeEstimate[] = []
  const reject = (reason: string) => { statistics.rejected++; statistics.reasons[reason] = (statistics.reasons[reason] || 0) + 1 }
  const seen = new Set<string>()
  for (const raw of input) {
    const row = parseProviderRow(raw)
    if (!row) { reject('incomplete_row'); continue }
    if (row.id !== stopId || row.ligne !== lineId) { reject('different_stop_or_line'); continue }
    const [match] = await db.all<{ directionId: string; headsign: string; destinationName: string; count: number }>(`
      SELECT t.direction_id AS directionId,CASE WHEN st.headsign<>'' THEN st.headsign ELSE t.headsign END AS headsign,
        dest.name AS destinationName,COUNT(*) AS count
      FROM trips t JOIN stop_times st ON st.trip_id=t.id
      JOIN stops s ON s.id=st.stop_id AND s.location_type=0
      JOIN stop_times final ON final.trip_id=t.id AND final.stop_id=? AND final.sequence>st.sequence
      JOIN stops dest ON dest.id=final.stop_id AND dest.location_type=0
      WHERE t.id=? AND t.route_id=? AND st.stop_id=? AND st.pickup_type<>1
    `, [row.idtarretdestination, row.coursetheorique, lineId, stopId])
    if (!match || match.count !== 1) { reject('identity_or_destination_unverified'); continue }
    if (normalizeSearch(row.direction) !== normalizeSearch(match.headsign || match.destinationName)) { reject('direction_conflict'); continue }
    statistics.matched++
    // T reste théorique : ne devient jamais une estimation, même fourni par cette API.
    if (row.type !== 'E') continue
    const departure = providerInstant(row.heurepassage)
    const updated = providerInstant(row.last_update_fme)
    if (departure === null || updated === null) { reject('invalid_or_ambiguous_time'); continue }
    if (updated > now + 5000 || now - updated >= maxAgeMs || departure <= now || departure > now + 86400000) { reject('expired_or_future_data'); continue }
    const key = `${row.coursetheorique}\u0000${stopId}\u0000${departure}`
    if (seen.has(key)) { reject('duplicate'); continue }
    seen.add(key)
    estimates.push({ tripId: row.coursetheorique, lineId, stopId, directionId: match.directionId,
      headsign: match.headsign || match.destinationName, estimatedTime: new Date(departure).toISOString(),
      sourceUpdatedAt: new Date(updated).toISOString(), validUntil: new Date(Math.min(updated + maxAgeMs, departure)).toISOString(), kind: 'estimated' })
  }
  statistics.matchRate = input.length ? statistics.matched / input.length : null
  estimates.sort((a, b) => a.estimatedTime.localeCompare(b.estimatedTime))
  return { estimates: estimates.slice(0, 12), statistics }
}

/** Niveau 1 : le passage est rattaché à un quai et à une ligne exacts. La
 * destination commerciale ne sert jamais à attribuer le passage. */
export async function mapStopPassages(db: QueryDatabase, input: unknown[], lineId: string, stopId: string, now: number, maxAgeMs: number): Promise<{ estimates: RealtimeEstimate[]; statistics: MappingStatistics }> {
  const statistics: MappingStatistics = { received: input.length, matched: 0, rejected: 0, matchRate: null, reasons: {} }
  const estimates: RealtimeEstimate[] = []
  const reject = (reason: string) => { statistics.rejected++; statistics.reasons[reason] = (statistics.reasons[reason] || 0) + 1 }
  const seen = new Set<string>()
  for (const raw of input) {
    const row = parseProviderRow(raw)
    if (!row) { reject('incomplete_row'); continue }
    if (row.id !== stopId || row.ligne !== lineId) { reject('different_stop_or_line'); continue }
    const [match] = await db.all<{ directionId: string; headsign: string; serviceId: string; departure: number; count: number }>(`
      SELECT t.direction_id AS directionId,
        CASE WHEN st.headsign<>'' THEN st.headsign ELSE t.headsign END AS headsign,
        t.service_id AS serviceId, st.departure AS departure,
        COUNT(*) AS count
      FROM trips t JOIN stop_times st ON st.trip_id=t.id
      JOIN stops s ON s.id=st.stop_id AND s.location_type=0
      WHERE t.id=? AND t.route_id=? AND st.stop_id=? AND st.pickup_type<>1
    `, [row.coursetheorique, lineId, stopId])
    if (!match || match.count !== 1) { reject('trip_stop_line_unverified'); continue }
    const departure = providerInstant(row.heurepassage)
    const updated = providerInstant(row.last_update_fme)
    if (departure === null || updated === null) { reject('invalid_or_ambiguous_time'); continue }
    if (updated > now + 5000 || now - updated >= maxAgeMs || departure <= now || departure > now + 86400000) { reject('expired_or_future_data'); continue }
    // Le trip_id GTFS peut se répéter chaque jour. Vérifier aussi que son service
    // circule à une date compatible avec l'heure GTFS, y compris après minuit.
    const civilDate = localServiceDate(departure, 'Europe/Paris')
    const dates = [0, -1, -2, -3].map(offset => addDays(civilDate, offset))
      .filter(date => Math.abs(serviceDayOrigin(date, 'Europe/Paris') + match.departure * 1000 - departure) <= 6 * 3600_000)
    let active = false
    for (const date of dates) {
      const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
      const [service] = await db.all<{ active: number }>(`
        SELECT CASE WHEN c.exception_type IS NOT NULL THEN c.exception_type=1
          ELSE ? BETWEEN s.start_date AND s.end_date AND
            CASE ? WHEN 0 THEN s.monday WHEN 1 THEN s.tuesday WHEN 2 THEN s.wednesday
              WHEN 3 THEN s.thursday WHEN 4 THEN s.friday WHEN 5 THEN s.saturday ELSE s.sunday END=1 END AS active
        FROM services s LEFT JOIN calendar_dates c ON c.service_id=s.id AND c.date=? WHERE s.id=?
      `, [date, weekday, date, match.serviceId])
      if (service?.active) { active = true; break }
    }
    if (!active) { reject('service_calendar_unverified'); continue }
    const key = `${row.coursetheorique}\u0000${stopId}\u0000${departure}\u0000${row.type}`
    if (seen.has(key)) { reject('duplicate'); continue }
    seen.add(key)
    statistics.matched++
    estimates.push({ tripId: row.coursetheorique, lineId, stopId, directionId: match.directionId,
      headsign: row.direction, directionReliable: normalizeSearch(row.direction) === normalizeSearch(match.headsign),
      estimatedTime: new Date(departure).toISOString(), sourceUpdatedAt: new Date(updated).toISOString(),
      validUntil: new Date(Math.min(updated + maxAgeMs, departure)).toISOString(), kind: row.type === 'E' ? 'estimated' : 'theoretical' })
  }
  statistics.matchRate = input.length ? statistics.matched / input.length : null
  estimates.sort((a, b) => a.estimatedTime.localeCompare(b.estimatedTime))
  return { estimates: estimates.slice(0, 12), statistics }
}
