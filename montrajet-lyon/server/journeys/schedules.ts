import type { QueryDatabase } from '../gtfs/repository.ts'
import type { FeedMetadata } from '../../src/types/gtfs.ts'
import { addDays, localServiceDate, serviceDayOrigin } from '../gtfs/time.ts'

export interface LegPair { from: string; to: string; routes: string[] }
export interface ScheduledLeg {
  pairIndex: number
  tripId: string
  routeId: string
  directionId: string
  headsign: string
  serviceDate: string
  fromId: string
  toId: string
  fromSequence: number
  toSequence: number
  departure: number
  arrival: number
  departureSeconds: number
  arrivalSeconds: number
  fromTimepoint: number
  toTimepoint: number
}
export function serviceDays(metadata: FeedMetadata, low: number, high: number) {
  const days = []
  const start = addDays(localServiceDate(low, metadata.timezone), -Math.ceil(metadata.maxDepartureSeconds / 86400) - 1)
  const end = addDays(localServiceDate(high, metadata.timezone), 1)
  for (let date = start; date <= end; date = addDays(date, 1)) {
    if (date < metadata.validFrom || date > metadata.validUntil) continue
    const origin = serviceDayOrigin(date, metadata.timezone)
    if (origin > high || origin + metadata.maxDepartureSeconds * 1000 < low) continue
    days.push({ date, origin, lower: (low - origin) / 1000, upper: (high - origin) / 1000, weekday: (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7 })
  }
  return days
}

/** Jointures indexées sur les seuls couples d'arrêts utiles. Aucun chargement de
 * l'ensemble des stop_times ; calendriers et exceptions traités dans SQLite/D1.
 */
export async function scheduledLegs(db: QueryDatabase, pairs: LegPair[], days: ReturnType<typeof serviceDays>, low: number, high: number): Promise<ScheduledLeg[]> {
  if (!pairs.length || !days.length) return []
  return db.all<ScheduledLeg>(`
    WITH pairs AS (SELECT CAST(key AS INTEGER) AS pairIndex,json_extract(value,'$.from') AS a,json_extract(value,'$.to') AS b,json_extract(value,'$.routes') AS routes FROM json_each(?)),
    days AS (SELECT json_extract(value,'$.date') AS date,json_extract(value,'$.origin') AS origin,json_extract(value,'$.lower') AS lower,json_extract(value,'$.upper') AS upper,json_extract(value,'$.weekday') AS weekday FROM json_each(?))
    SELECT p.pairIndex,t.id AS tripId,t.route_id AS routeId,t.direction_id AS directionId,
      CASE WHEN a.headsign<>'' THEN a.headsign ELSE t.headsign END AS headsign,d.date AS serviceDate,
      a.stop_id AS fromId,b.stop_id AS toId,a.sequence AS fromSequence,b.sequence AS toSequence,
      d.origin+a.departure*1000 AS departure,d.origin+b.arrival*1000 AS arrival,
      a.departure AS departureSeconds,b.arrival AS arrivalSeconds,a.timepoint AS fromTimepoint,b.timepoint AS toTimepoint
    FROM pairs p CROSS JOIN days d
    JOIN stop_times a ON a.stop_id=p.a AND a.departure>=d.lower AND a.departure<=d.upper
    JOIN trips t ON t.id=a.trip_id AND t.route_id IN(SELECT value FROM json_each(p.routes))
    JOIN stop_times b ON b.trip_id=t.id AND b.stop_id=p.b AND b.sequence>a.sequence
    JOIN services s ON s.id=t.service_id
    LEFT JOIN calendar_dates c ON c.service_id=t.service_id AND c.date=d.date
    WHERE a.pickup_type=0 AND b.drop_off_type=0 AND b.arrival IS NOT NULL AND b.arrival>=a.departure
      AND d.origin+b.arrival*1000 BETWEEN ? AND ?
      AND CASE WHEN c.exception_type IS NOT NULL THEN c.exception_type=1
        ELSE d.date BETWEEN s.start_date AND s.end_date AND CASE d.weekday
          WHEN 0 THEN s.monday WHEN 1 THEN s.tuesday WHEN 2 THEN s.wednesday WHEN 3 THEN s.thursday
          WHEN 4 THEN s.friday WHEN 5 THEN s.saturday ELSE s.sunday END=1 END
    ORDER BY departure,arrival,t.id,a.sequence,b.sequence LIMIT 20001
  `, [JSON.stringify(pairs), JSON.stringify(days), low, high])
}
