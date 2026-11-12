import type { JourneyTrafficNotice, TrafficIncident, TrafficReference, TrafficMode } from '../../src/types/traffic.ts'
import type { QueryDatabase } from '../gtfs/repository.ts'
import { overlaps } from './time.ts'

export const routeMode = (type: number): TrafficMode | undefined => type === 0 || type === 900 ? 'tram' : type === 1 ? 'metro' : type === 7 || type === 1400 ? 'funicular' : [3, 11, 800].includes(type) || type >= 700 && type < 800 ? 'bus' : undefined
/** Names of platforms are never used. A commercial line + mode is only partial. */
export async function mapIncidents(db: QueryDatabase, incidents: TrafficIncident[]): Promise<TrafficIncident[]> {
  const routes = await db.all<{ id: string; name: string; type: number }>('SELECT id,short_name AS name,type FROM routes')
  const wanted = incidents.flatMap(i => [...(i.stops || []), ...(i.removedStops || []), ...(i.replacementStops || [])]).filter(r => r.namespace === 'gtfs' && r.sourceId).map(r => r.sourceId!)
  const stops = wanted.length ? await db.all<{ id: string }>('SELECT id FROM stops WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify(wanted)]) : []
  const stopIds = new Set(stops.map(s => s.id))
  const mapStop = (ref: TrafficReference): TrafficReference => ({ ...ref, gtfsIds: ref.namespace === 'gtfs' && ref.sourceId && stopIds.has(ref.sourceId) ? [ref.sourceId] : [], precision: ref.namespace === 'gtfs' && ref.sourceId && stopIds.has(ref.sourceId) ? 'exact' : 'unmatched' })
  return incidents.map(incident => {
    const lines: TrafficReference[] = incident.lines.map(ref => {
      const candidates = routes.filter(r => (!ref.mode || routeMode(r.type) === ref.mode) && (ref.namespace === 'gtfs' ? r.id === ref.sourceId : r.name === ref.label))
      return { ...ref, gtfsIds: candidates.map(r => r.id), precision: !candidates.length ? 'unmatched' : ref.namespace === 'gtfs' ? 'exact' : 'partial' }
    })
    return { ...incident, lines, stops: incident.stops?.map(mapStop), removedStops: incident.removedStops?.map(mapStop), replacementStops: incident.replacementStops?.map(mapStop), mapping: lines.length && lines.every(l => l.precision === 'exact') ? 'exact' : lines.some(l => l.gtfsIds.length) ? 'partial' : 'unmatched' }
  })
}
export interface AffectedLeg { routeId: string; directionId: string; start: number; end: number; stops: { id: string; at: number }[] }
export function matchJourney(incidents: TrafficIncident[], legs: AffectedLeg[]): JourneyTrafficNotice[] {
  return incidents.flatMap(incident => legs.flatMap((leg, legIndex) => {
    const lines = incident.lines.filter(l => l.gtfsIds.includes(leg.routeId))
    const stops = [...(incident.stops || []), ...(incident.removedStops || [])].filter(s => s.precision === 'exact' && leg.stops.some(p => s.gtfsIds.includes(p.id)))
    if (incident.lines.some(l => l.gtfsIds.length) && !lines.length) return []
    if (!lines.length && !stops.length) return []
    if (incident.directionIds?.length && !incident.directionIds.includes(leg.directionId)) return []
    const overlap = overlaps(incident, leg.start, leg.end)
    if (overlap === false) return []
    const exactStopTime = stops.some(s => leg.stops.some(p => s.gtfsIds.includes(p.id) && overlaps(incident, p.at, p.at) === true))
    // Line-wide wording alone never proves that this trip or segment is unusable.
    const level: JourneyTrafficNotice['level'] = !stops.length || overlap === null ? 'general' : exactStopTime && (!incident.directions?.length || !!incident.directionIds?.length) && (!incident.lines.length || lines.some(l => l.precision === 'exact')) ? 'confirmed' : 'possible'
    return [{ incidentId: incident.id, level, title: incident.title, sourceUrl: incident.sourceUrl, legIndex, reason: level === 'confirmed' ? 'Arrêt identifié et plage officielle correspondant au passage GTFS. Aucune exclusion automatique.' : level === 'possible' ? 'Élément concerné ; segment, direction ou instant non confirmés. Consultez l’annonce officielle.' : 'Annonce au niveau de la ligne : aucun impact précis sur cette course ou ce quai n’est établi.' }]
  }))
}
