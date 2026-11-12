import type { QueryDatabase } from '../gtfs/repository.ts'
import { getMetadata } from '../gtfs/repository.ts'
import type { JourneyTransfer, RideLeg, RoutingQuery, RoutingResult, TheoreticalJourney } from '../../src/types/journey.ts'
import { loadTopology, transferPolicy } from './topology.ts'
import type { Topology } from './topology.ts'
import { scheduledLegs, serviceDays } from './schedules.ts'
import type { LegPair, ScheduledLeg } from './schedules.ts'
import type { VerifiedTransfer } from '../../src/types/mobility.ts'
import { createNetworkPlanner } from './network.ts'
import type { RoutingLimits } from './limits.ts'
import type { NetworkSeeds } from './network.ts'
import type { ProgressObserver } from '../../src/types/searchProgress.ts'
import { reportStage } from '../search/progress.ts'

interface Path { legs: ScheduledLeg[]; connection: JourneyTransfer | null }
const duration = (path: Path) => path.legs.at(-1)!.arrival - path.legs[0].departure
function comparison(query: RoutingQuery) {
  return (a: Path, b: Path) => {
    const arrival = a.legs.at(-1)!.arrival - b.legs.at(-1)!.arrival
    const departure = b.legs[0].departure - a.legs[0].departure
    const length = duration(a) - duration(b)
    const transfers = a.legs.length - b.legs.length
    switch (query.order) {
      case 'duration': return length || transfers || arrival || departure
      case 'transfers': return transfers || (query.mode === 'arrival' ? departure : arrival) || length
      case 'departure': return departure || length || transfers || arrival
      default: return arrival || length || transfers || departure
    }
  }
}
function lowerBound(legs: ScheduledLeg[], time: number) {
  let lo = 0, hi = legs.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (legs[mid].departure < time) lo = mid + 1; else hi = mid }
  return lo
}
function publicLeg(leg: ScheduledLeg, topology: Topology): RideLeg {
  const line = topology.routes.get(leg.routeId)!
  return {
    tripId: leg.tripId, serviceDate: leg.serviceDate, routeId: leg.routeId,
    lineName: line.short_name || line.long_name, routeType: line.type, directionId: leg.directionId, headsign: leg.headsign,
    from: { id: leg.fromId, name: topology.stops.get(leg.fromId)!.name, sequence: leg.fromSequence },
    to: { id: leg.toId, name: topology.stops.get(leg.toId)!.name, sequence: leg.toSequence },
    departureTime: new Date(leg.departure).toISOString(), arrivalTime: new Date(leg.arrival).toISOString(),
    departureGtfsSeconds: leg.departureSeconds, arrivalGtfsSeconds: leg.arrivalSeconds,
    interpolatedBySource: leg.fromTimepoint === 0 || leg.toTimepoint === 0,
  }
}

/** Moteur borné : directs et une correspondance, élagage topologique puis
 * jointures temporelles indexées. Ce n'est pas un RAPTOR réseau complet.
 */
function createLegacyJourneyPlanner(db: QueryDatabase) {
  let cachedTopology: Promise<Topology> | null = null
  let cachedHash = ''
  return {
    async search(query: RoutingQuery, pedestrianTransfers: VerifiedTransfer[] = [], progress?: ProgressObserver): Promise<RoutingResult> {
      await reportStage(progress, 'connections')
      if (!Number.isInteger(query.marginSeconds) || query.marginSeconds < 30 || query.marginSeconds > 1800) throw new Error('La marge doit être comprise entre 30 et 1800 secondes.')
      const started = performance.now()
      let sqlQueries = 0
      const measured: QueryDatabase = { all: async <T>(sql: string, values?: (string | number | null)[]) => { sqlQueries++; return db.all<T>(sql, values) } }
      const metadata = await getMetadata(measured)
      const coldTopology = !cachedTopology || cachedHash !== metadata.sha256
      if (coldTopology) {
        cachedHash = metadata.sha256
        cachedTopology = loadTopology(measured).catch(error => { cachedTopology = null; throw error })
      }
      const topology = await cachedTopology!
      const walks = new Map(pedestrianTransfers.map(edge => [JSON.stringify([edge.from, edge.to]), edge.path]))
      const edges = new Map(topology.edges)
      for (const edge of pedestrianTransfers) if (!edges.has(JSON.stringify([edge.from, edge.to]))) edges.set(JSON.stringify([edge.from, edge.to]), { from: edge.from, to: edge.to })
      for (const id of [query.fromStopId, query.toStopId]) if (topology.stops.get(id)?.location_type !== 0) throw new Error('Sélectionnez des quais GTFS existants.')
      if (query.fromStopId === query.toStopId) throw new Error('Le départ et l’arrivée doivent être différents.')
      const at = Date.parse(query.at)
      const low = query.mode === 'departure' ? at : at - 6 * 3600000
      const high = query.mode === 'departure' ? at + 6 * 3600000 : at
      const scope = { maxTransfers: 1 as const, windowHours: 6 as const, from: new Date(low).toISOString(), until: new Date(high).toISOString(), marginSeconds: query.marginSeconds }
      const metrics = { durationMs: 0, sqlQueries: 0, legCount: 0, transferPairs: 0, candidateCount: 0, coldTopology }
      const warnings = [
        'Périmètre : trajets directs ou une correspondance, dans une fenêtre de six heures. Pas de marche d’accès ou de sortie.',
        `Marge de sécurité ajoutée au minimum officiel : ${query.marginSeconds} s (hypothèse configurable).`,
        'Les changements de quai sans lien orienté et durée minimale GTFS sont exclus. Le temps de marche seul n’est pas inventé.',
        'Sélection diversifiée de six propositions au maximum ; les perturbations et le temps réel ne sont pas pris en compte.',
      ]
      if (pedestrianTransfers.length) {
        warnings[2] = 'Changements de quai limités aux liens GTFS ou aux parcours piétons IGN fournis ; aucune durée à vol d’oiseau.'
        warnings.push('Liens piétons supplémentaires calculés par IGN sur le réseau BD TOPO ; durées estimées. Les interdictions GTFS restent prioritaires.')
      }
      const finish = (state: RoutingResult['state'], itineraries: TheoreticalJourney[] = []): RoutingResult => {
        metrics.durationMs = Math.round((performance.now() - started) * 100) / 100
        metrics.sqlQueries = sqlQueries
        return { state, itineraries, query, metadata, scope, metrics, warnings }
      }
      const days = serviceDays(metadata, low, high)
      if (!days.length) return finish('outside_validity')
      const fromRoutes = topology.stopRoutes.get(query.fromStopId) || new Set<string>()
      const toRoutes = topology.stopRoutes.get(query.toStopId) || new Set<string>()
      const intersection = (routes: Set<string> | undefined, wanted: Set<string>) => [...routes || []].filter(id => wanted.has(id))
      const directRoutes = intersection(fromRoutes, toRoutes)
      const pairs: LegPair[] = []
      const pairIndices = new Map<string, number>()
      function addPair(from: string, to: string, routes: string[]) {
        const key = JSON.stringify([from, to])
        const existing = pairIndices.get(key)
        if (existing !== undefined) { pairs[existing].routes = [...new Set([...pairs[existing].routes, ...routes])]; return existing }
        const index = pairs.push({ from, to, routes }) - 1
        pairIndices.set(key, index); return index
      }
      const direct = directRoutes.length ? addPair(query.fromStopId, query.toStopId, directRoutes) : -1
      const connections: { from: string; to: string; first: number; second: number }[] = []
      for (const edge of edges.values()) {
        if ([query.fromStopId, query.toStopId].includes(edge.from) || [query.fromStopId, query.toStopId].includes(edge.to)) continue
        const first = intersection(topology.stopRoutes.get(edge.from), fromRoutes)
        const second = intersection(topology.stopRoutes.get(edge.to), toRoutes)
        if (!first.length || !second.length) continue
        connections.push({ ...edge, first: addPair(query.fromStopId, edge.from, first), second: addPair(edge.to, query.toStopId, second) })
      }
      metrics.transferPairs = connections.length
      if (connections.length > 256) { warnings.push('Limite de 256 liens de correspondance atteinte : recherche refusée pour ne pas annoncer un classement incomplet.'); return finish('limited') }
      const legs = await scheduledLegs(measured, pairs, days, low, high)
      metrics.legCount = legs.length
      if (legs.length > 20000) { warnings.push('Plus de 20 000 tronçons candidats : réduisez le périmètre. Aucun résultat tronqué n’est présenté.'); return finish('limited') }
      const byPair = new Map<number, ScheduledLeg[]>()
      for (const leg of legs) { const group = byPair.get(leg.pairIndex) || []; group.push(leg); byPair.set(leg.pairIndex, group) }
      const compare = comparison(query)
      const bestPatterns = new Map<string, Path>()
      let bestSchedules: Path[] = []
      const directLegs = byPair.get(direct) || []
      const dominates = (a: Path, b: Path) => a.legs[0].departure >= b.legs[0].departure && a.legs.at(-1)!.arrival <= b.legs.at(-1)!.arrival && a.legs.length <= b.legs.length &&
        (a.legs[0].departure > b.legs[0].departure || a.legs.at(-1)!.arrival < b.legs.at(-1)!.arrival || a.legs.length < b.legs.length)
      function consider(path: Path) {
        metrics.candidateCount++
        if (path.legs.length > 1 && directLegs.some(leg => leg.departure >= path.legs[0].departure && leg.arrival <= path.legs.at(-1)!.arrival)) return
        if (bestSchedules.some(existing => dominates(existing, path)) || [...bestPatterns.values()].some(existing => dominates(existing, path))) return
        for (const [key, existing] of bestPatterns) if (dominates(path, existing)) bestPatterns.delete(key)
        const pattern = JSON.stringify(path.legs.map(leg => [leg.routeId, leg.fromId, leg.toId, leg.directionId]))
        const previous = bestPatterns.get(pattern)
        if (!previous || compare(path, previous) < 0) bestPatterns.set(pattern, path)
        bestSchedules = bestSchedules.filter(existing => !dominates(path, existing))
        bestSchedules.push(path)
        bestSchedules.sort(compare)
        bestSchedules = bestSchedules.slice(0, 6)
      }
      for (const leg of directLegs) consider({ legs: [leg], connection: null })
      let checks = 0
      for (const edge of connections) {
        const arriving = byPair.get(edge.first) || []
        const departing = byPair.get(edge.second) || []
        for (const first of arriving) {
          for (let index = lowerBound(departing, first.arrival + query.marginSeconds * 1000); index < departing.length; index++) {
            if (++checks > 200000) { warnings.push('Budget de combinaisons dépassé : aucun résultat partiel présenté.'); return finish('limited') }
            const second = departing[index]
            if (first.tripId === second.tripId && first.serviceDate === second.serviceDate) continue
            const walk = walks.get(JSON.stringify([edge.from, edge.to]))
            const policy = transferPolicy(topology, edge.from, edge.to, first, second, walk?.durationSeconds)
            if (!policy) continue
            const required = policy.minimum + query.marginSeconds
            const interval = (second.departure - first.arrival) / 1000
            if (interval < required) continue
            consider({ legs: [first, second], connection: {
              fromStopId: edge.from, fromStopName: topology.stops.get(edge.from)!.name,
              toStopId: edge.to, toStopName: topology.stops.get(edge.to)!.name,
              ruleId: policy.ruleId, source: policy.source, officialMinimumSeconds: policy.officialMinimum,
              marginSeconds: query.marginSeconds, requiredSeconds: required,
              intervalSeconds: interval, spareSeconds: interval - required, walkingSeconds: policy.walking,
              ...(policy.walking !== null && policy.walking > 0 && walk ? { walkingPath: walk } : {}),
            } })
          }
        }
      }
      await reportStage(progress, 'ranking')
      const selected: Path[] = [...bestPatterns.values()].sort(compare).slice(0, 6)
      const identity = (path: Path) => JSON.stringify(path.legs.map(leg => [leg.tripId, leg.serviceDate, leg.fromSequence, leg.toSequence]))
      const seen = new Set(selected.map(identity))
      for (const path of bestSchedules) if (selected.length < 6 && !seen.has(identity(path))) { selected.push(path); seen.add(identity(path)) }
      selected.sort(compare)
      const itineraries = selected.map((path, index) => ({
        id: `proposal-${index + 1}`, kind: 'theoretical' as const, departureTime: new Date(path.legs[0].departure).toISOString(),
        arrivalTime: new Date(path.legs.at(-1)!.arrival).toISOString(), durationSeconds: duration(path) / 1000,
        initialWaitSeconds: query.mode === 'departure' ? (path.legs[0].departure - at) / 1000 : 0,
        transfers: path.legs.length - 1, legs: path.legs.map(leg => publicLeg(leg, topology)), connection: path.connection,
      }))
      return finish(itineraries.length ? 'ok' : 'no_journey', itineraries)
    },
  }
}
export function createJourneyPlanner(db: QueryDatabase, limits?: RoutingLimits) {
  const legacy = createLegacyJourneyPlanner(db)
  const network = createNetworkPlanner(db, limits)
  return {
    search: (query: RoutingQuery, pedestrian: VerifiedTransfer[] = [], seeds?: NetworkSeeds, signal?: AbortSignal, progress?: ProgressObserver) => query.maxTransfers === 2 || seeds ? network.search(query, pedestrian, seeds, signal, progress) : legacy.search(query, pedestrian, progress),
  }
}
export type JourneyPlanner = ReturnType<typeof createJourneyPlanner>
