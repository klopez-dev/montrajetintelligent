import type { FeedMetadata, GtfsLine, GtfsStop, PassageResult, TheoreticalPassage } from '../../src/types/gtfs.ts'
import { addDays, localServiceDate, normalizeSearch, serviceDayOrigin } from './time.ts'

export interface QueryDatabase {
  all<T>(sql: string, parameters?: (string | number | null)[]): Promise<T[]>
}

export async function getMetadata(db: QueryDatabase): Promise<FeedMetadata> {
  const [row] = await db.all<{ json: string }>('SELECT json FROM metadata WHERE id=1')
  if (!row) throw new Error('Métadonnées GTFS absentes.')
  const metadata: FeedMetadata = JSON.parse(row.json)
  if (metadata.schemaVersion !== 1) throw new Error('Version de base GTFS incompatible.')
  return metadata
}

export async function searchLines(db: QueryDatabase, query: string): Promise<GtfsLine[]> {
  const key = normalizeSearch(query).slice(0, 80)
  if (!key) return []
  return db.all<GtfsLine>(`
    SELECT r.id, CASE WHEN r.short_name='' THEN r.long_name ELSE r.short_name END AS name,
      r.short_name AS shortName,r.long_name AS longName,r.type
    FROM routes r WHERE r.id IN (
      SELECT entity_id FROM search_tokens WHERE kind='line' AND token>=? AND token<?
    ) ORDER BY CASE WHEN r.short_name=? THEN 0 ELSE 1 END,LENGTH(r.short_name),r.short_name,r.id LIMIT 20
  `, [key, `${key}\uffff`, query.trim()])
}

export async function searchStops(db: QueryDatabase, query: string, lineId = ''): Promise<GtfsStop[]> {
  const key = normalizeSearch(query).slice(0, 80)
  if (!key) return []
  return db.all<GtfsStop>(`
    SELECT s.id,s.name,s.code,s.platform,s.parent_id AS parentId,s.latitude,s.longitude
    FROM stops s WHERE s.location_type=0 AND s.id IN (
      SELECT entity_id FROM search_tokens WHERE kind='stop' AND token>=? AND token<?
    ) ${lineId ? 'AND EXISTS(SELECT 1 FROM route_stops rs WHERE rs.route_id=? AND rs.stop_id=s.id)' : ''}
    ORDER BY s.name,s.code,s.id LIMIT 20
  `, [key, `${key}\uffff`, ...(lineId ? [lineId] : [])])
}

export async function getDirections(db: QueryDatabase, lineId: string, stopId: string) {
  return db.all<{ id: string; headsign: string }>(`
    SELECT DISTINCT t.direction_id AS id,t.headsign FROM trips t
    JOIN stop_times st ON st.trip_id=t.id WHERE t.route_id=? AND st.stop_id=?
    ORDER BY t.direction_id,t.headsign LIMIT 50
  `, [lineId, stopId])
}

/** Fenêtre bornée à 24 h, jusqu'à 12 résultats, jours précédents inclus.
 * Les services et exceptions sont joints côté SQL : pas de GTFS chargé en mémoire.
 */
export async function getPassages(db: QueryDatabase, lineId: string, stopId: string, instant: number, direction?: string): Promise<PassageResult> {
  if (!Number.isFinite(instant)) throw new Error('Instant de recherche invalide.')
  const metadata = await getMetadata(db)
  const windowEnd = instant + 24 * 3600_000
  const currentDate = localServiceDate(instant, metadata.timezone)
  // Un jour de service peut commencer avant le minuit civil au passage à l'heure d'été.
  const finalDate = addDays(localServiceDate(windowEnd, metadata.timezone), 1)
  const previousDays = Math.ceil(metadata.maxDepartureSeconds / 86400) + 1
  const days = []
  for (let date = addDays(currentDate, -previousDays); date <= finalDate; date = addDays(date, 1)) {
    if (date < metadata.validFrom || date > metadata.validUntil) continue
    const origin = serviceDayOrigin(date, metadata.timezone)
    if (origin + metadata.maxDepartureSeconds * 1000 < instant || origin >= windowEnd) continue
    days.push({ date, origin, lower: (instant - origin) / 1000, upper: (windowEnd - origin) / 1000, weekday: (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7 })
  }
  if (!days.length) return { passages: [], metadata, queriedAt: new Date(instant).toISOString(), windowEnd: new Date(windowEnd).toISOString(), outsideValidity: true }
  type Row = Omit<TheoreticalPassage, 'departureTime' | 'kind' | 'interpolated'> & { epoch: number; timepoint: number }
  const rows = await db.all<Row>(`
    WITH days AS (SELECT json_extract(value,'$.date') AS date,json_extract(value,'$.origin') AS origin,
      json_extract(value,'$.lower') AS lower,json_extract(value,'$.upper') AS upper,
      json_extract(value,'$.weekday') AS weekday FROM json_each(?))
    SELECT t.id AS tripId,st.stop_id AS stopId,t.route_id AS lineId,t.direction_id AS directionId,
      CASE WHEN st.headsign<>'' THEN st.headsign ELSE t.headsign END AS headsign,
      d.date AS serviceDate,st.departure AS gtfsSeconds,st.timepoint,st.pickup_type AS pickupType,
      d.origin+st.departure*1000 AS epoch
    FROM days d CROSS JOIN stop_times st
    JOIN trips t ON t.id=st.trip_id
    JOIN services s ON s.id=t.service_id
    LEFT JOIN calendar_dates c ON c.service_id=s.id AND c.date=d.date
    WHERE st.stop_id=? AND st.departure>=d.lower AND st.departure<d.upper
      AND st.pickup_type<>1 AND t.route_id=? ${direction !== undefined ? 'AND t.direction_id=?' : ''}
      AND CASE WHEN c.exception_type IS NOT NULL THEN c.exception_type=1
        ELSE d.date BETWEEN s.start_date AND s.end_date AND
          CASE d.weekday WHEN 0 THEN s.monday WHEN 1 THEN s.tuesday WHEN 2 THEN s.wednesday
            WHEN 3 THEN s.thursday WHEN 4 THEN s.friday WHEN 5 THEN s.saturday ELSE s.sunday END=1 END
    ORDER BY epoch,t.id,st.sequence LIMIT 12
  `, [JSON.stringify(days), stopId, lineId, ...(direction !== undefined ? [direction] : [])])
  return {
    passages: rows.map(({ epoch, timepoint, ...row }) => ({ ...row, departureTime: new Date(epoch).toISOString(), kind: 'theoretical', interpolated: timepoint === 0 })),
    metadata, queriedAt: new Date(instant).toISOString(), windowEnd: new Date(windowEnd).toISOString(), outsideValidity: false,
  }
}
