import type { QueryDatabase } from '../gtfs/repository.ts'
import { getMetadata } from '../gtfs/repository.ts'
import { loadTopology, transferPolicy } from './topology.ts'
import type { Topology } from './topology.ts'
import { serviceDays } from './schedules.ts'
import type { RoutingQuery, RoutingResult, RideLeg, JourneyTransfer, TheoreticalJourney } from '../../src/types/journey.ts'
import type { VerifiedTransfer } from '../../src/types/mobility.ts'
import { defaultRoutingLimits } from './limits.ts'
import type { RoutingLimits } from './limits.ts'
import type { ProgressObserver } from '../../src/types/searchProgress.ts'
import { reportStage } from '../search/progress.ts'

export interface NetworkSeeds { origins: { id: string; seconds: number }[]; destinations: { id: string; seconds: number }[] }
interface Event { tripId: string; routeId: string; directionId: string; tripHeadsign: string; serviceDate: string; origin: number; stopId: string; sequence: number; arrival: number | null; departure: number | null; headsign: string; pickup: number; dropoff: number; timepoint: number }
interface Leg { a: Event; b: Event }
interface Label { stop: string; at: number; seed: string; legs: Leg[]; connections: JourneyTransfer[]; profile?: string }
interface Option { label: Label; from: string; to: string; threshold: number }
const eventTime = (event: Event, departure: boolean) => event.origin + (departure ? event.departure! : event.arrival!) * 1000
const firstTime = (label: Label) => eventTime(label.legs[0].a, true)
const lastTime = (label: Label) => eventTime(label.legs.at(-1)!.b, false)
function publicLeg(leg: Leg, topology: Topology): RideLeg {
  const { a, b } = leg, route = topology.routes.get(a.routeId)!
  return { tripId: a.tripId, serviceDate: a.serviceDate, routeId: a.routeId, lineName: route.short_name || route.long_name, routeType: route.type, directionId: a.directionId, headsign: a.headsign || a.tripHeadsign, from: { id: a.stopId, name: topology.stops.get(a.stopId)!.name, sequence: a.sequence }, to: { id: b.stopId, name: topology.stops.get(b.stopId)!.name, sequence: b.sequence }, departureTime: new Date(eventTime(a, true)).toISOString(), arrivalTime: new Date(eventTime(b, false)).toISOString(), departureGtfsSeconds: a.departure!, arrivalGtfsSeconds: b.arrival!, interpolatedBySource: a.timepoint === 0 || b.timepoint === 0 }
}

/** Exact Pareto filter for the existing rule: only fewer transfers can dominate,
 * and only for the same boarding and alighting platforms. */
export function removeDominatedJourneys(all: TheoreticalJourney[]): TheoreticalJourney[] {
  type Index = { departures: number[]; minimumArrivals: number[] }
  const groups = new Map<string, Map<number, TheoreticalJourney[]>>()
  for (const journey of all) {
    const key = JSON.stringify([journey.legs[0].from.id, journey.legs.at(-1)!.to.id])
    const byTransfers = groups.get(key) || new Map<number, TheoreticalJourney[]>()
    const list = byTransfers.get(journey.transfers) || []
    list.push(journey); byTransfers.set(journey.transfers, list); groups.set(key, byTransfers)
  }
  const indices = new Map<string, Map<number, Index>>()
  for (const [key, byTransfers] of groups) {
    const indexed = new Map<number, Index>()
    for (const [transfers, journeys] of byTransfers) {
      const ordered = journeys.map(item => ({ departure: Date.parse(item.departureTime), arrival: Date.parse(item.arrivalTime) })).sort((a, b) => b.departure - a.departure)
      const departures: number[] = [], minimumArrivals: number[] = []
      let minimum = Infinity
      for (const item of ordered) { departures.push(item.departure); minimum = Math.min(minimum, item.arrival); minimumArrivals.push(minimum) }
      indexed.set(transfers, { departures, minimumArrivals })
    }
    indices.set(key, indexed)
  }
  return all.filter(journey => {
    const key = JSON.stringify([journey.legs[0].from.id, journey.legs.at(-1)!.to.id])
    const departure = Date.parse(journey.departureTime), arrival = Date.parse(journey.arrivalTime)
    for (const [transfers, index] of indices.get(key)!) {
      if (transfers >= journey.transfers) continue
      let low = 0, high = index.departures.length
      while (low < high) { const middle = (low + high) >>> 1; if (index.departures[middle] >= departure) low = middle + 1; else high = middle }
      if (low && index.minimumArrivals[low - 1] <= arrival) return false
    }
    return true
  })
}

/** Bounded multi-label, trip-scanning rounds, inspired by RAPTOR. Each SQL batch
 * loads only courses boardable at marked stops. Reverse rounds implement deadlines.
 * Route IDs are not assumed to be RAPTOR patterns (branches/overtaking are allowed).
 */
export function createNetworkPlanner(db: QueryDatabase, limits: RoutingLimits = defaultRoutingLimits) {
  let topologyPromise: Promise<Topology> | undefined, hash = ''
  const cache = new Map<string, { at: number; result: RoutingResult }>()
  return {
    async search(query: RoutingQuery, pedestrian: VerifiedTransfer[] = [], seeds?: NetworkSeeds, signal?: AbortSignal, progress?: ProgressObserver): Promise<RoutingResult> {
      if (!seeds && query.fromStopId === query.toStopId) throw new Error('Le départ et l’arrivée doivent être différents.')
      if (![1, 2].includes(query.maxTransfers ?? 2)) throw new Error('Choisissez une ou deux correspondances maximum.')
      const start = performance.now()
      await reportStage(progress, 'connections')
      let sqlMs = 0, sqlQueries = 0
      const measured: QueryDatabase = { all: async <T>(sql: string, values: (string | number | null)[] = []) => { const t = performance.now(); sqlQueries++; try { return await db.all<T>(sql, values) } finally { sqlMs += performance.now() - t } } }
      const topologyStart = performance.now()
      const metadata = await getMetadata(measured)
      if (hash !== metadata.sha256) { hash = metadata.sha256; topologyPromise = undefined; cache.clear() }
      const coldTopology = !topologyPromise
      topologyPromise ??= loadTopology(measured).catch(error => { topologyPromise = undefined; throw error })
      const topology = await topologyPromise
      const topologyMs = performance.now() - topologyStart
      if (!Number.isInteger(query.marginSeconds) || query.marginSeconds < 30 || query.marginSeconds > 1800) throw new Error('La marge doit être comprise entre 30 et 1800 secondes.')
      const at = Date.parse(query.at), reverse = query.mode === 'arrival', maxTransfers = query.maxTransfers ?? 2
      const low = reverse ? at - 21600000 : at, high = reverse ? at : at + 21600000
      const initial = seeds ? { origins: [...seeds.origins].sort((a, b) => a.id.localeCompare(b.id)), destinations: [...seeds.destinations].sort((a, b) => a.id.localeCompare(b.id)) } : { origins: [{ id: query.fromStopId, seconds: 0 }], destinations: [{ id: query.toStopId, seconds: 0 }] }
      for (const seed of [...initial.origins, ...initial.destinations]) if (topology.stops.get(seed.id)?.location_type !== 0 || !Number.isFinite(seed.seconds) || seed.seconds < 0) throw new Error('Sélectionnez des quais GTFS existants.')
      const key = JSON.stringify([hash, query, initial, pedestrian.map(walk => [walk.from, walk.to, walk.path.durationSeconds, walk.path.fetchedAt, walk.path.resourceVersion])])
      const hit = cache.get(key)
      if (hit && Date.now() - hit.at < 60000) { await reportStage(progress, 'reuse'); return { ...hit.result, metrics: { ...hit.result.metrics, cacheHit: true, durationMs: performance.now() - start, sqlQueries, sqlMs, routingMs: performance.now() - start - sqlMs, coldTopology, topologyMs, roundMs: [], roundSqlMs: [], rankingMs: 0 } } }
      const scope: RoutingResult['scope'] = { maxTransfers, windowHours: 6, from: new Date(low).toISOString(), until: new Date(high).toISOString(), marginSeconds: query.marginSeconds }
      const warnings = [`Recherche par tours : ${maxTransfers} correspondance(s) maximum, fenêtre de six heures, sans temps réel.`, 'Transferts orientés GTFS et parcours IGN confirmés uniquement. Même quai : déplacement interarrêt nul retenu comme hypothèse ; marge ajoutée.', 'Sélection de propositions, sans garantie d’optimalité globale ; les limites de profils et de ressources sont signalées.']
      const metrics: RoutingResult['metrics'] = { durationMs: 0, sqlQueries: 0, sqlMs: 0, routingMs: 0, legCount: 0, transferPairs: 0, candidateCount: 0, coldTopology, rounds: 0, limited: false, cacheHit: false, topologyMs, roundMs: [], roundSqlMs: [], rankingMs: 0 }
      const finish = (state: RoutingResult['state'], itineraries: TheoreticalJourney[] = []): RoutingResult => {
        metrics.durationMs = performance.now() - start; metrics.sqlQueries = sqlQueries; metrics.sqlMs = sqlMs; metrics.routingMs = Math.max(0, metrics.durationMs - sqlMs)
        const result = { state, itineraries, query, metadata, scope, metrics, warnings }
        if (cache.size >= 24) cache.delete(cache.keys().next().value!)
        cache.set(key, { at: Date.now(), result })
        return result
      }
      const days = serviceDays(metadata, low, high)
      if (!days.length) return finish('outside_validity')
      const origins = new Map(initial.origins.map(seed => [seed.id, seed.seconds])), destinations = new Map(initial.destinations.map(seed => [seed.id, seed.seconds]))
      const walkMap = new Map(pedestrian.map(walk => [JSON.stringify([walk.from, walk.to]), walk.path]))
      const tripRules = topology.rules.some(rule => rule.from_trip_id || rule.to_trip_id)
      const policies = new Map<string, ReturnType<typeof transferPolicy>>()
      const profile = (label: Label) => label.profile ??= JSON.stringify(label.legs.map(leg => [leg.a.routeId, leg.a.directionId]))
      const edges = new Map(topology.edges)
      for (const walk of pedestrian) edges.set(JSON.stringify([walk.from, walk.to]), { from: walk.from, to: walk.to })
      const adjacency = new Map<string, { from: string; to: string }[]>()
      for (const edge of edges.values()) { const id = reverse ? edge.to : edge.from; const list = adjacency.get(id) || []; list.push(edge); adjacency.set(id, list) }
      // Static route reachability is only a safe superset; exact trips/times/rules
      // are always checked after scanning, including restrictions by trip/route.
      const goalRoutes = new Set([...(reverse ? origins : destinations).keys()].flatMap(id => [...topology.stopRoutes.get(id) || []]))
      const reachable = [goalRoutes]
      for (let i = 0; i < maxTransfers; i++) {
        const next = new Set(reachable[i])
        for (const edge of edges.values()) {
          const outgoing = topology.stopRoutes.get(reverse ? edge.from : edge.to)
          if ([...outgoing || []].some(id => reachable[i].has(id))) for (const route of topology.stopRoutes.get(reverse ? edge.to : edge.from) || []) next.add(route)
        }
        reachable.push(next)
      }
      let frontier: Label[] = [...(reverse ? destinations : origins)].map(([id, seconds]) => ({ stop: id, at: at + (reverse ? -seconds : seconds) * 1000, seed: id, legs: [], connections: [] }))
      const completed: Label[] = []
      let created = 0
      function limited(message: string) { metrics.limited = true; if (!warnings.includes(message)) warnings.push(message) }
      function check() { signal?.throwIfAborted(); if (performance.now() - start > limits.deadlineMs) { limited('Budget de temps de calcul atteint : exploration partielle.'); return false } return true }
      for (let round = 0; round <= maxTransfers && frontier.length && check(); round++) {
        const roundStart = performance.now(), roundSqlStart = sqlMs
        try {
        metrics.rounds = round + 1
        const options = new Map<string, Option[]>()
        for (const label of frontier) {
          const links = label.legs.length ? adjacency.get(label.stop) || [] : [{ from: label.stop, to: label.stop }]
          for (const edge of links) {
            const id = reverse ? edge.from : edge.to
            if (![...topology.stopRoutes.get(id) || []].some(route => reachable[maxTransfers - round].has(route))) continue
            const threshold = label.at + (reverse ? -1 : 1) * (label.legs.length ? query.marginSeconds * 1000 : 0)
            const group = options.get(id) || []; group.push({ label, ...edge, threshold }); options.set(id, group)
          }
        }
        metrics.transferPairs += options.size
        if (options.size > limits.maxBoardStops) { limited('Budget de quais marqués atteint : tours suivants non explorés.'); break }
        const boards = [...options].map(([id, values]) => ({ id, threshold: reverse ? Math.max(...values.map(v => v.threshold)) : Math.min(...values.map(v => v.threshold)) }))
        if (!boards.length) break
        const remaining = limits.maxEvents - metrics.legCount
        if (remaining < 1) { limited('Budget d’événements horaires atteint.'); break }
        const needed = new Set([...options.keys(), ...(reverse ? origins : destinations).keys()])
        if (round < maxTransfers) for (const edge of edges.values()) {
          if ([...topology.stopRoutes.get(reverse ? edge.from : edge.to) || []].some(route => reachable[maxTransfers - round - 1].has(route))) needed.add(reverse ? edge.to : edge.from)
        }
        const events = await measured.all<Event>(`
          WITH days AS (SELECT json_extract(value,'$.date') date,json_extract(value,'$.origin') origin,json_extract(value,'$.lower') lower,json_extract(value,'$.upper') upper,json_extract(value,'$.weekday') weekday FROM json_each(?)),
          boards AS (SELECT json_extract(value,'$.id') id,json_extract(value,'$.threshold') threshold FROM json_each(?)),
          candidates AS MATERIALIZED (
            SELECT DISTINCT a.trip_id,d.date,d.origin FROM boards b CROSS JOIN days d
            JOIN stop_times a ON a.stop_id=b.id AND a.${reverse ? 'arrival' : 'departure'} BETWEEN d.lower AND d.upper
              AND d.origin+a.${reverse ? 'arrival' : 'departure'}*1000 ${reverse ? '<=' : '>='} b.threshold
            JOIN trips t INDEXED BY sqlite_autoindex_trips_1 ON t.id=a.trip_id JOIN services s ON s.id=t.service_id
            LEFT JOIN calendar_dates c ON c.service_id=t.service_id AND c.date=d.date
            WHERE a.${reverse ? 'drop_off_type' : 'pickup_type'}=0 AND t.route_id IN(SELECT value FROM json_each(?))
              AND CASE WHEN c.exception_type IS NOT NULL THEN c.exception_type=1 ELSE d.date BETWEEN s.start_date AND s.end_date AND CASE d.weekday WHEN 0 THEN s.monday WHEN 1 THEN s.tuesday WHEN 2 THEN s.wednesday WHEN 3 THEN s.thursday WHEN 4 THEN s.friday WHEN 5 THEN s.saturday ELSE s.sunday END=1 END
          )
          SELECT t.id tripId,t.route_id routeId,t.direction_id directionId,t.headsign tripHeadsign,c.date serviceDate,c.origin,
            st.stop_id stopId,st.sequence,st.arrival,st.departure,st.headsign,st.pickup_type pickup,st.drop_off_type dropoff,st.timepoint
          FROM candidates c JOIN trips t ON t.id=c.trip_id JOIN stop_times st ON st.trip_id=c.trip_id
          WHERE st.stop_id IN(SELECT value FROM json_each(?))
          ORDER BY c.date,t.id,st.sequence ${reverse ? 'DESC' : 'ASC'} LIMIT ?
        `, [JSON.stringify(days), JSON.stringify(boards), JSON.stringify([...reachable[maxTransfers - round]]), JSON.stringify([...needed]), remaining + 1])
        if (events.length > remaining) { limited('Budget d’événements horaires atteint : lot incomplet refusé, aucun trajet construit à partir de ce lot.'); break }
        metrics.legCount += events.length
        const next: Label[] = [], buckets = new Map<string, Label[]>()
        let onboard = new Map<string, { label: Label; boundary: Event; connection: JourneyTransfer | null }>(), tripKey = ''
        for (const event of events) {
          if (!check()) break
          const current = JSON.stringify([event.serviceDate, event.tripId])
          if (current !== tripKey) { tripKey = current; onboard = new Map() }
          const canFinish = reverse ? event.pickup === 0 && event.departure !== null : event.dropoff === 0 && event.arrival !== null
          if (canFinish) for (const active of onboard.values()) {
            const leg = reverse ? { a: event, b: active.boundary } : { a: active.boundary, b: event }
            if (leg.a.sequence >= leg.b.sequence || eventTime(leg.b, false) < eventTime(leg.a, true)) continue
            const time = eventTime(event, reverse), connections = active.connection ? reverse ? [active.connection, ...active.label.connections] : [...active.label.connections, active.connection] : active.label.connections
            const label: Label = { stop: event.stopId, at: time, seed: active.label.seed, legs: reverse ? [leg, ...active.label.legs] : [...active.label.legs, leg], connections }
            if (time < low || time > high) continue
            const goalOffset = (reverse ? origins : destinations).get(event.stopId)
            if (goalOffset !== undefined && (reverse ? time - goalOffset * 1000 >= low : time + goalOffset * 1000 <= high)) {
              if (completed.length < limits.maxLabels) completed.push(label)
              else limited('Budget de propositions intermédiaires atteint : exploration partielle.')
            }
            if (round === maxTransfers) continue
            const bucketKey = JSON.stringify([event.stopId, event.tripId, event.serviceDate, label.seed, profile(label)])
            const existing = buckets.get(bucketKey) || []
            const better = (a: Label, b: Label) => reverse ? lastTime(a) < lastTime(b) : firstTime(a) > firstTime(b)
            if (existing.some(value => !better(label, value))) continue
            if (!existing.length) created++
            buckets.set(bucketKey, [label])
            if (created > limits.maxLabels) { limited('Budget de profils atteint : exploration partielle.'); break }
          }
          if (created > limits.maxLabels) break
          const canBoard = reverse ? event.dropoff === 0 && event.arrival !== null : event.pickup === 0 && event.departure !== null
          if (!canBoard) continue
          const time = eventTime(event, !reverse)
          for (const option of options.get(event.stopId) || []) {
            const prior = option.label
            if (reverse ? time > option.threshold : time < option.threshold) continue
            if (prior.legs.some(leg => leg.a.tripId === event.tripId && leg.a.serviceDate === event.serviceDate)) continue
            let connection: JourneyTransfer | null = null
            if (prior.legs.length) {
              const previous = reverse ? prior.legs[0].a : prior.legs.at(-1)!.a
              const walk = walkMap.get(JSON.stringify([option.from, option.to]))
              const arriving = reverse ? event : previous, departing = reverse ? previous : event
              const policyKey = JSON.stringify([option.from, option.to, tripRules ? arriving.tripId : arriving.routeId, tripRules ? departing.tripId : departing.routeId])
              if (!policies.has(policyKey)) policies.set(policyKey, transferPolicy(topology, option.from, option.to, arriving, departing, walk?.durationSeconds))
              const policy = policies.get(policyKey)
              if (!policy) continue
              const interval = (reverse ? prior.at - time : time - prior.at) / 1000, required = policy.minimum + query.marginSeconds
              if (interval < required) continue
              connection = { fromStopId: option.from, fromStopName: topology.stops.get(option.from)!.name, toStopId: option.to, toStopName: topology.stops.get(option.to)!.name, ruleId: policy.ruleId, source: policy.source, officialMinimumSeconds: policy.officialMinimum, marginSeconds: query.marginSeconds, requiredSeconds: required, intervalSeconds: interval, spareSeconds: interval - required, walkingSeconds: policy.walking, ...(walk && policy.walking !== null && policy.walking > 0 ? { walkingPath: walk } : {}) }
            }
            const onboardKey = JSON.stringify([prior.seed, profile(prior)])
            const previous = onboard.get(onboardKey)
            const home = (label: Label, boundary: Event) => label.legs.length ? reverse ? lastTime(label) : firstTime(label) : eventTime(boundary, !reverse)
            if (!previous || (reverse ? home(prior, event) < home(previous.label, previous.boundary) : home(prior, event) > home(previous.label, previous.boundary))) onboard.set(onboardKey, { label: prior, boundary: event, connection })
          }
        }
        const byStop = new Map<string, number>()
        const ordered = [...buckets.values()].flat().sort((a, b) => reverse ? b.at - a.at : a.at - b.at)
        for (const label of ordered) {
          const count = byStop.get(label.stop) || 0
          if (count >= limits.maxLabelsPerStop) { limited('Budget de profils par quai atteint : exploration partielle, aucun horaire modifié.'); continue }
          byStop.set(label.stop, count + 1); next.push(label)
        }
        frontier = next
        if (created > limits.maxLabels) break
        } finally {
          metrics.roundMs!.push(performance.now() - roundStart)
          metrics.roundSqlMs!.push(sqlMs - roundSqlStart)
        }
      }
      metrics.candidateCount = completed.length
      await reportStage(progress, 'ranking')
      const rankingStart = performance.now()
      const candidates = completed.map((label): TheoreticalJourney => ({ id: '', kind: 'theoretical', departureTime: new Date(firstTime(label)).toISOString(), arrivalTime: new Date(lastTime(label)).toISOString(), durationSeconds: (lastTime(label) - firstTime(label)) / 1000, initialWaitSeconds: reverse ? 0 : (firstTime(label) - at - (origins.get(label.legs[0].a.stopId) || 0) * 1000) / 1000, transfers: label.legs.length - 1, legs: label.legs.map(leg => publicLeg(leg, topology)), connections: label.connections, connection: label.connections[0] || null }))
      const compare = (a: TheoreticalJourney, b: TheoreticalJourney) => {
        const arr = Date.parse(a.arrivalTime) + (destinations.get(a.legs.at(-1)!.to.id) || 0) * 1000 - Date.parse(b.arrivalTime) - (destinations.get(b.legs.at(-1)!.to.id) || 0) * 1000
        const dep = Date.parse(b.departureTime) - (origins.get(b.legs[0].from.id) || 0) * 1000 - Date.parse(a.departureTime) + (origins.get(a.legs[0].from.id) || 0) * 1000
        const dur = a.durationSeconds + (origins.get(a.legs[0].from.id) || 0) + (destinations.get(a.legs.at(-1)!.to.id) || 0) - b.durationSeconds - (origins.get(b.legs[0].from.id) || 0) - (destinations.get(b.legs.at(-1)!.to.id) || 0)
        return query.order === 'departure' ? dep || dur || a.transfers - b.transfers : query.order === 'duration' ? dur || arr : query.order === 'transfers' ? a.transfers - b.transfers || (reverse ? dep : arr) : arr || dur || a.transfers - b.transfers || dep
      }
      const unique = new Map<string, TheoreticalJourney>()
      for (const journey of candidates) unique.set(JSON.stringify(journey.legs.map(leg => [leg.tripId, leg.serviceDate, leg.from.sequence, leg.to.sequence])), journey)
      const all = [...unique.values()].sort(compare)
      const ranked = removeDominatedJourneys(all), selected: TheoreticalJourney[] = [], patterns = new Set<string>()
      for (const journey of ranked) { const pattern = JSON.stringify(journey.legs.map(leg => [leg.routeId, leg.directionId, leg.from.id, leg.to.id])); if (!patterns.has(pattern) && selected.length < (seeds ? 48 : 6)) { patterns.add(pattern); selected.push(journey) } }
      for (const journey of ranked) if (selected.length < (seeds ? 48 : 6) && !selected.includes(journey)) selected.push(journey)
      selected.sort(compare); selected.forEach((journey, index) => { journey.id = `network-${index + 1}` })
      metrics.rankingMs = performance.now() - rankingStart
      return finish(metrics.limited ? 'limited' : selected.length ? 'ok' : 'no_journey', selected)
    },
  }
}
