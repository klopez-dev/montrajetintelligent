import type { QueryDatabase } from '../gtfs/repository.ts'

export interface StopNode { id: string; name: string; parent_id: string; location_type: number }
export interface RouteNode { id: string; short_name: string; long_name: string; type: number }
export interface TransferRule {
  id: number
  from_stop_id: string | null
  to_stop_id: string | null
  from_route_id: string | null
  to_route_id: string | null
  from_trip_id: string | null
  to_trip_id: string | null
  transfer_type: number
  min_transfer_time: number | null
}
export interface Topology {
  stops: Map<string, StopNode>
  routes: Map<string, RouteNode>
  stopRoutes: Map<string, Set<string>>
  rules: TransferRule[]
  ruleIndex: Map<string, TransferRule[]>
  linkedRules: TransferRule[]
  edges: Map<string, { from: string; to: string }>
}
const key = (from: string, to: string) => JSON.stringify([from, to])
export async function loadTopology(db: QueryDatabase): Promise<Topology> {
  const stops = await db.all<StopNode>('SELECT id,name,parent_id,location_type FROM stops')
  const routes = await db.all<RouteNode>('SELECT id,short_name,long_name,type FROM routes')
  const memberships = await db.all<{ stop_id: string; route_id: string }>('SELECT stop_id,route_id FROM route_stops')
  const rules = await db.all<TransferRule>('SELECT * FROM transfers')
  const stopRoutes = new Map<string, Set<string>>()
  for (const row of memberships) {
    const current = stopRoutes.get(row.stop_id) || new Set<string>()
    current.add(row.route_id); stopRoutes.set(row.stop_id, current)
  }
  const children = new Map<string, string[]>()
  for (const stop of stops) if (stop.location_type === 0 && stop.parent_id) children.set(stop.parent_id, [...children.get(stop.parent_id) || [], stop.id])
  const stopMap = new Map(stops.map(stop => [stop.id, stop]))
  const platforms = (id: string | null) => !id ? [] : stopMap.get(id)?.location_type === 0 ? [id] : children.get(id) || []
  const edges = new Map<string, { from: string; to: string }>()
  for (const stop of stops) if (stop.location_type === 0 && stopRoutes.has(stop.id)) edges.set(key(stop.id, stop.id), { from: stop.id, to: stop.id })
  for (const rule of rules) {
    // Pas de graphe géographique déduit des coordonnées, ni de symétrisation.
    if (rule.transfer_type !== 2 || rule.min_transfer_time === null) continue
    for (const from of platforms(rule.from_stop_id)) for (const to of platforms(rule.to_stop_id)) edges.set(key(from, to), { from, to })
  }
  const ruleIndex = new Map<string, TransferRule[]>()
  const linkedRules: TransferRule[] = []
  for (const rule of rules) {
    if (!rule.from_stop_id || !rule.to_stop_id) { linkedRules.push(rule); continue }
    const pair = key(rule.from_stop_id, rule.to_stop_id)
    ruleIndex.set(pair, [...ruleIndex.get(pair) || [], rule])
  }
  return { stops: stopMap, routes: new Map(routes.map(route => [route.id, route])), stopRoutes, rules, edges, ruleIndex, linkedRules }
}

interface TripIdentity { tripId: string; routeId: string }
function specificity(rule: TransferRule) {
  const trips = Number(Boolean(rule.from_trip_id)) + Number(Boolean(rule.to_trip_id))
  const routes = Number(Boolean(rule.from_route_id)) + Number(Boolean(rule.to_route_id))
  return trips === 2 ? 6 : trips === 1 && routes ? 5 : trips === 1 ? 4 : routes === 2 ? 3 : routes === 1 ? 2 : 1
}
export function transferPolicy(topology: Topology, from: string, to: string, arriving: TripIdentity, departing: TripIdentity, pedestrianSeconds?: number): { ruleId: number | null; minimum: number; officialMinimum: number; walking: number | null; source: 'gtfs' | 'same_platform_assumption' | 'ign_pedestrian' } | null {
  const matchesStop = (specified: string | null, actual: string) => specified === actual || (specified !== null && topology.stops.get(actual)?.parent_id === specified)
  const fromKeys = [from, topology.stops.get(from)?.parent_id].filter(Boolean) as string[]
  const toKeys = [to, topology.stops.get(to)?.parent_id].filter(Boolean) as string[]
  const candidates = [...topology.linkedRules]
  for (const a of fromKeys) for (const b of toKeys) candidates.push(...topology.ruleIndex.get(key(a, b)) || [])
  const applicable = candidates.filter(rule =>
    (rule.from_stop_id ? matchesStop(rule.from_stop_id, from) : rule.transfer_type >= 4) &&
    (rule.to_stop_id ? matchesStop(rule.to_stop_id, to) : rule.transfer_type >= 4) &&
    (!rule.from_trip_id || rule.from_trip_id === arriving.tripId) && (!rule.to_trip_id || rule.to_trip_id === departing.tripId) &&
    (!rule.from_route_id || rule.from_route_id === arriving.routeId) && (!rule.to_route_id || rule.to_route_id === departing.routeId))
  if (!applicable.length) return from === to ? { ruleId: null, minimum: 0, officialMinimum: 0, walking: 0, source: 'same_platform_assumption' } : pedestrianSeconds !== undefined && Number.isInteger(pedestrianSeconds) && pedestrianSeconds > 0 ? { ruleId: null, minimum: pedestrianSeconds, officialMinimum: 0, walking: pedestrianSeconds, source: 'ign_pedestrian' } : null
  const rank = Math.max(...applicable.map(specificity))
  const strongest = applicable.filter(rule => specificity(rule) === rank)
  // Une égalité de spécificité ambiguë est refusée, jamais arbitrairement résolue.
  if (strongest.length !== 1) return null
  const rule = strongest[0]
  if (rule.transfer_type >= 3) return null
  if (rule.transfer_type === 2 && rule.min_transfer_time !== null && rule.min_transfer_time >= 0) {
    const verifiedWalk = from !== to && Number.isInteger(pedestrianSeconds) && pedestrianSeconds! > 0 ? pedestrianSeconds! : null
    return { ruleId: rule.id, minimum: Math.max(rule.min_transfer_time, verifiedWalk || 0), officialMinimum: rule.min_transfer_time, walking: from === to ? 0 : verifiedWalk, source: 'gtfs' }
  }
  // Types 0/1 sans temps vérifiable : admis seulement si c'est exactement le même quai.
  return from === to ? { ruleId: rule.id, minimum: 0, officialMinimum: 0, walking: 0, source: 'same_platform_assumption' } : null
}
