import type { QueryDatabase } from '../gtfs/repository.ts'
import { getMetadata } from '../gtfs/repository.ts'
import { createJourneyPlanner } from '../journeys/planner.ts'
import { serviceDays } from '../journeys/schedules.ts'
import { loadTopology } from '../journeys/topology.ts'
import type { Topology } from '../journeys/topology.ts'
import type { DoorJourney, MobilityQuery, MobilityResult, PlaceReference, Point, VerifiedTransfer, WalkPath } from '../../src/types/mobility.ts'
import type { GeographicProvider } from './provider.ts'
import { distance, GeographicError, geographicTrace } from './provider.ts'
import { defaultRoutingLimits } from '../journeys/limits.ts'
import type { RoutingLimits } from '../journeys/limits.ts'
import type { ProgressObserver } from '../../src/types/searchProgress.ts'
import { reportStage } from '../search/progress.ts'

interface Platform extends Point { id: string; name: string }
interface Access { stop: Platform; path: WalkPath | null }
interface TransferCandidate { a: Platform; b: Platform; meters: number }
export function compareDoorJourneys(query: MobilityQuery, a: DoorJourney, b: DoorJourney) {
  const arrival = Date.parse(a.arrivalTime) - Date.parse(b.arrivalTime), departure = Date.parse(b.departureTime) - Date.parse(a.departureTime)
  const duration = a.durationSeconds - b.durationSeconds, transfers = a.transit.transfers - b.transit.transfers
  switch (query.order) {
    case 'duration': return duration || arrival || transfers
    case 'transfers': return transfers || (query.mode === 'arrival' ? departure : arrival) || duration
    case 'walking': return Number(a.unknownTransferWalking) - Number(b.unknownTransferWalking) || a.walkingSeconds - b.walkingSeconds || arrival
    case 'waiting': return Number(a.waitingSeconds === null) - Number(b.waitingSeconds === null) || (a.waitingSeconds ?? Infinity) - (b.waitingSeconds ?? Infinity) || arrival
    case 'departure': return departure || duration || transfers
    default: return arrival || duration || transfers
  }
}
export function selectDoorJourneys(query: MobilityQuery, choices: DoorJourney[]): DoorJourney[] {
  const seen = new Set<string>()
  const unique = choices.filter(item => { const id = JSON.stringify(item.transit.legs.map(leg => [leg.tripId, leg.serviceDate, leg.from.id, leg.to.id])); if (seen.has(id)) return false; seen.add(id); return true })
  const dominates = (a: DoorJourney, b: DoorJourney) => !a.unknownTransferWalking && a.waitingSeconds !== null &&
    (b.waitingSeconds !== null ? a.waitingSeconds <= b.waitingSeconds : query.order !== 'waiting') &&
    Date.parse(a.departureTime) >= Date.parse(b.departureTime) && Date.parse(a.arrivalTime) <= Date.parse(b.arrivalTime) && a.durationSeconds <= b.durationSeconds && a.transit.transfers <= b.transit.transfers && a.walkingSeconds <= b.walkingSeconds &&
    (a.durationSeconds < b.durationSeconds || a.transit.transfers < b.transit.transfers || a.walkingSeconds < b.walkingSeconds || b.waitingSeconds !== null && a.waitingSeconds < b.waitingSeconds)
  const ranked = unique.filter(item => !unique.some(other => other !== item && dominates(other, item))).sort((a, b) => compareDoorJourneys(query, a, b))
  const patterns = new Set<string>(), selected: DoorJourney[] = []
  for (const item of ranked) {
    const pattern = JSON.stringify(item.transit.legs.map(leg => [leg.routeId, leg.directionId, leg.from.id, leg.to.id]))
    if (!patterns.has(pattern) && selected.length < 6) { patterns.add(pattern); selected.push(item) }
  }
  for (const item of ranked) if (selected.length < 6 && !selected.includes(item)) selected.push(item)
  return selected.sort((a, b) => compareDoorJourneys(query, a, b))
}
export function doorJourney(query: MobilityQuery, transitResult: DoorJourney['transitResult'], transit: DoorJourney['transit'], access: WalkPath | null, egress: WalkPath | null, fromName: string, toName: string): DoorJourney {
  const safetySeconds = access ? query.marginSeconds : 0
  const departure = Date.parse(transit.departureTime) - ((access?.durationSeconds || 0) + safetySeconds) * 1000
  const arrival = Date.parse(transit.arrivalTime) + (egress?.durationSeconds || 0) * 1000
  const connections = transit.connections ?? (transit.connection ? [transit.connection] : [])
  const walkingSeconds = (access?.durationSeconds || 0) + (egress?.durationSeconds || 0) + connections.reduce((sum, connection) => sum + (connection.walkingSeconds || 0), 0)
  const unknownTransferWalking = connections.some(connection => connection.walkingSeconds === null)
  return { transit, transitResult, access, egress, fromName, toName, safetySeconds, departureTime: new Date(departure).toISOString(), arrivalTime: new Date(arrival).toISOString(), durationSeconds: (arrival - departure) / 1000, walkingSeconds, unknownTransferWalking, waitingSeconds: unknownTransferWalking ? null : safetySeconds + connections.reduce((sum, connection) => sum + connection.intervalSeconds - (connection.walkingSeconds || 0), 0) }
}
/** Bounded composition of network pedestrian access and the validated GTFS engine. */
export function createMobilityPlanner(db: QueryDatabase, provider: GeographicProvider, limits: RoutingLimits = defaultRoutingLimits) {
  const transit = createJourneyPlanner(db, limits)
  let graph: Promise<Topology> | undefined
  let platformRows: Promise<Platform[]> | undefined
  let platformIndex: Map<string, Platform> | undefined
  let surfaceIds: Set<string> | undefined
  let feedHash = ''
  const neighborhoods = new Map<string, { at: number; rows: { stop: Platform; routes: Set<string> }[] }>()
  // Only immutable geometric candidates, never schedules or provider failures.
  const transferCandidates = new Map<string, TransferCandidate[]>()
  return {
    async search(query: MobilityQuery, signal: AbortSignal = AbortSignal.timeout(limits.deadlineMs), progress?: ProgressObserver): Promise<MobilityResult> {
      const started = performance.now(), warnings = [
        'Horaires TCL théoriques. Marche estimée par IGN BD TOPO, sans vérification sur le terrain ni garantie d’accessibilité PMR.',
        `Périmètre : accès de surface dans un rayon de ${limits.radiusMeters} m ; parcours IGN de ${limits.maxAccessSeconds} s maximum, jusqu’à ${query.maxTransfers ?? 2} correspondances, six heures. La distance géométrique sert au filtrage, jamais au temps affiché.`,
        'Raccordement au réseau piéton toléré jusqu’à 25 m par extrémité : ce petit accès n’est pas décrit par IGN. La marge avant embarquement est une hypothèse configurable, pas une garantie de correspondance.',
        'Pas d’accès piéton nouveau aux quais métro/funiculaire : les entrées, escaliers et contrôles ne sont pas connus. Aucun parcours entièrement à pied calculé.',
        'Nouveaux liens entre quais distincts distants de moins de 15 m exclus : les coordonnées proches ou confondues ne décrivent pas les traversées de voies.',
        'Les nouveaux liens piétons privilégient des lignes différentes ; les changements de sens sur une même ligne restent limités aux transferts GTFS existants.',
      ]
      const metrics: MobilityResult['metrics'] = { durationMs: 0, transitSearches: 0, walkingCalls: 0, sqlMs: 0, sqlQueries: 0, candidatePlatforms: 0, confirmedPlatforms: 0, walkBudgetReached: false, transferCandidatesMs: 0, transferCandidatesCacheHit: false }
      const trace = geographicTrace()
      const measured: QueryDatabase = { all: async <T>(sql: string, values: (string | number | null)[] = []) => { const t = performance.now(); metrics.sqlQueries!++; try { return await db.all<T>(sql, values) } finally { metrics.sqlMs! += performance.now() - t } } }
      const metadata = await getMetadata(measured)
      if (metadata.sha256 !== feedHash) { feedHash = metadata.sha256; graph = undefined; platformRows = undefined; platformIndex = undefined; surfaceIds = undefined; neighborhoods.clear(); transferCandidates.clear() }
      graph ??= loadTopology(measured).catch(error => { graph = undefined; throw error })
      const topology = await graph
      platformRows ??= measured.all<Platform>('SELECT id,name,latitude,longitude FROM stops WHERE location_type=0 AND latitude IS NOT NULL AND longitude IS NOT NULL').catch(error => { platformRows = undefined; throw error })
      const rows = await platformRows
      const platforms = platformIndex ??= new Map(rows.map(stop => [stop.id, stop]))
      surfaceIds ??= new Set([...topology.stopRoutes].filter(([, routes]) => routes.size > 0 && [...routes].every(route => [0, 3, 11].includes(topology.routes.get(route)!.type))).map(([id]) => id))
      const surface = (id: string) => surfaceIds!.has(id)
      const point = async (ref: PlaceReference) => {
        if (ref.kind === 'stop') { const stop = platforms.get(ref.id); if (!stop) throw new Error('Arrêt GTFS inconnu.'); return { ...stop, address: false } }
        const result = provider.resolveAddress ? await provider.resolveAddress(ref.id, ref.name, trace, signal) : (await provider.addresses(ref.name, trace, signal)).find(address => address.id === ref.id)
        if (!result) throw new GeographicError('Adresse non confirmée par son fournisseur. Sélectionnez-la à nouveau.')
        if (ref.expectedCoordinates && (ref.expectedCoordinates.latitude !== result.latitude || ref.expectedCoordinates.longitude !== result.longitude)) throw new GeographicError('Les coordonnées de l’adresse enregistrée ont changé dans la BAN. Sélectionnez à nouveau l’adresse ; aucun remplacement silencieux.')
        if (result.precision !== 'housenumber') throw new GeographicError('Sélectionnez une adresse avec numéro : le centre d’une rue ne permet pas un départ domicile fiable.')
        return { ...result, address: true }
      }
      const at = Date.parse(query.at)
      const days = serviceDays(metadata, query.mode === 'departure' ? at : at - 7 * 3600000, query.mode === 'departure' ? at + 7 * 3600000 : at)
      if (!days.length) return { state: 'outside_validity', itineraries: [], warnings, metrics: { ...metrics, durationMs: performance.now() - started } }
      if (query.from.kind === 'address' || query.to.kind === 'address') await reportStage(progress, 'addresses')
      const geoStart = performance.now()
      const [from, to] = await Promise.all([point(query.from), point(query.to)])
      metrics.geocodingWallMs = performance.now() - geoStart
      const walk = async (a: Point, b: Point) => { signal.throwIfAborted(); if (metrics.walkingCalls >= limits.maxWalkRequests) { metrics.walkBudgetReached = true; throw new GeographicError('Budget de parcours piétons atteint, accès restant non vérifié.') } metrics.walkingCalls++; return provider.walk(a, b, trace, signal) }
      async function neighborhood(origin: typeof from, incoming: boolean) {
        if (!origin.address) return [{ stop: platforms.get(origin.id)!, routes: topology.stopRoutes.get(origin.id) || new Set<string>() }]
        const neighborhoodKey = JSON.stringify([feedHash, origin.id, incoming, query.at, query.mode, limits.radiusMeters])
        const cached = neighborhoods.get(neighborhoodKey)
        if (cached && Date.now() - cached.at < 60000) return cached.rows
        const nearby = rows.filter(stop => surface(stop.id) && distance(origin, stop) <= limits.radiusMeters).sort((a, b) => distance(origin, a) - distance(origin, b))
        if (!nearby.length) return []
        // A nominal route_stops membership can be a temporary works platform with
        // no service on the selected date. Filter actual pickup/dropoff events first.
        const active = await measured.all<{ stopId: string; routeId: string }>(`
          WITH days AS (SELECT json_extract(value,'$.date') date,json_extract(value,'$.lower') lower,json_extract(value,'$.upper') upper,json_extract(value,'$.weekday') weekday FROM json_each(?))
          SELECT DISTINCT st.stop_id AS stopId,t.route_id AS routeId
          FROM json_each(?) ids CROSS JOIN days d
          JOIN stop_times st ON st.stop_id=ids.value AND st.${incoming ? 'arrival' : 'departure'} BETWEEN d.lower AND d.upper
          JOIN trips t ON t.id=st.trip_id JOIN services s ON s.id=t.service_id
          LEFT JOIN calendar_dates c ON c.service_id=t.service_id AND c.date=d.date
          WHERE st.${incoming ? 'drop_off_type' : 'pickup_type'}=0 AND CASE WHEN c.exception_type IS NOT NULL THEN c.exception_type=1
            ELSE d.date BETWEEN s.start_date AND s.end_date AND CASE d.weekday WHEN 0 THEN s.monday WHEN 1 THEN s.tuesday WHEN 2 THEN s.wednesday WHEN 3 THEN s.thursday WHEN 4 THEN s.friday WHEN 5 THEN s.saturday ELSE s.sunday END=1 END
        `, [JSON.stringify(days), JSON.stringify(nearby.map(stop => stop.id))])
        const membership = new Map<string, Set<string>>()
        for (const item of active) { const routes = membership.get(item.stopId) || new Set<string>(); routes.add(item.routeId); membership.set(item.stopId, routes) }
        const result = nearby.filter(stop => membership.has(stop.id)).map(stop => ({ stop, routes: membership.get(stop.id)! }))
        if (neighborhoods.size >= 64) neighborhoods.delete(neighborhoods.keys().next().value!)
        neighborhoods.set(neighborhoodKey, { at: Date.now(), rows: result })
        return result
      }
      await reportStage(progress, 'stops')
      const stopsStart = performance.now()
      const fromNearby = await neighborhood(from, false), toNearby = await neighborhood(to, true)
      metrics.stopsWallMs = performance.now() - stopsStart
      metrics.candidatePlatforms = fromNearby.length + toNearby.length
      // Order candidates; do not cap retained platforms. Preserve useful shared
      // tram corridors before spending the walking budget on dense nearby bus stops.
      const originRoutes = new Set(fromNearby.flatMap(item => [...item.routes]))
      const destinationRoutes = new Set(toNearby.flatMap(item => [...item.routes]))
      const common = new Set([...originRoutes].filter(route => destinationRoutes.has(route)))
      const priority = (item: { routes: Set<string> }) => [...item.routes].some(route => common.has(route) && topology.routes.get(route)?.type === 0) ? 0 : [...item.routes].some(route => common.has(route)) ? 1 : 2
      fromNearby.sort((a, b) => priority(a) - priority(b) || distance(from, a.stop) - distance(from, b.stop))
      toNearby.sort((a, b) => priority(a) - priority(b) || distance(to, a.stop) - distance(to, b.stop))
      const allowedFrom = new Set<string>(), allowedTo = new Set<string>()
      const accessBudget = limits.maxWalkRequests - (query.walkingTransfers ? Math.min(6, Math.floor(limits.maxWalkRequests / 4)) : 0)
      let allocated = 0
      for (let index = 0; index < Math.max(fromNearby.length, toNearby.length) && allocated < accessBudget; index++) {
        if (from.address && fromNearby[index] && allocated < accessBudget) { allowedFrom.add(fromNearby[index].stop.id); allocated++ }
        if (to.address && toNearby[index] && allocated < accessBudget) { allowedTo.add(toNearby[index].stop.id); allocated++ }
      }
      if (from.address && allowedFrom.size < fromNearby.length || to.address && allowedTo.size < toNearby.length) metrics.walkBudgetReached = true
      const walkingStart = performance.now()
      await reportStage(progress, 'walking')
      const providerIssues: NonNullable<MobilityResult['providerIssues']> = []
      async function accesses(origin: typeof from, incoming: boolean): Promise<Access[]> {
        if (!origin.address) return [{ stop: platforms.get(origin.id)!, path: null }]
        const neighborhood = incoming ? toNearby : fromNearby
        const nearby = neighborhood.map(item => item.stop).filter(stop => (incoming ? allowedTo : allowedFrom).has(stop.id))
        const found: Access[] = []
        for (let index = 0; index < nearby.length; index += 2) {
          if (metrics.walkingCalls >= limits.maxWalkRequests) { metrics.walkBudgetReached = true; break }
          await Promise.all(nearby.slice(index, index + 2).map(async stop => {
            try { const path = await walk(incoming ? stop : origin, incoming ? origin : stop); if (path.durationSeconds <= limits.maxAccessSeconds) found.push({ stop, path }) }
            catch (error) { signal.throwIfAborted(); const message = `${origin.name} ↔ ${stop.name}, quai ${stop.id} : ${error instanceof Error ? error.message : 'parcours piéton indisponible'}`; warnings.push(message); providerIssues.push({ source: 'IGN', message }) }
          }))
        }
        return found.sort((a, b) => a.path!.durationSeconds - b.path!.durationSeconds || a.path!.distanceMeters - b.path!.distanceMeters)
      }
      const [origins, destinations] = await Promise.all([accesses(from, false), accesses(to, true)])
      metrics.accessWalkingMs = performance.now() - walkingStart
      metrics.confirmedPlatforms = origins.length + destinations.length
      const verified: VerifiedTransfer[] = []
      if (query.walkingTransfers && origins.length && destinations.length) {
        const candidateStart = performance.now()
        const fromRoutes = new Set(origins.flatMap(access => [...topology.stopRoutes.get(access.stop.id) || []]))
        const toRoutes = new Set(destinations.flatMap(access => [...topology.stopRoutes.get(access.stop.id) || []]))
        const candidateKey = JSON.stringify([feedHash, from.id, to.id, [...fromRoutes].sort(), [...toRoutes].sort()])
        let pairs = transferCandidates.get(candidateKey)
        metrics.transferCandidatesCacheHit = pairs !== undefined
        if (!pairs) {
          const starts = rows.filter(stop => surface(stop.id) && [...topology.stopRoutes.get(stop.id) || []].some(route => fromRoutes.has(route)))
          const ends = rows.filter(stop => surface(stop.id) && [...topology.stopRoutes.get(stop.id) || []].some(route => toRoutes.has(route)))
          pairs = starts.flatMap(a => ends.flatMap(b => {
            const meters = distance(a, b)
            if (a.id === b.id || topology.edges.has(JSON.stringify([a.id, b.id])) || a.id === from.id || b.id === to.id || meters > 350 || meters < 15) return []
            if ([...topology.stopRoutes.get(a.id) || []].some(route => topology.stopRoutes.get(b.id)?.has(route))) return []
            return [{ a, b, meters }]
          })).sort((a, b) => a.meters - b.meters).slice(0, 6)
          if (transferCandidates.size >= 64) transferCandidates.delete(transferCandidates.keys().next().value!)
          transferCandidates.set(candidateKey, pairs)
        }
        metrics.transferCandidatesMs = performance.now() - candidateStart
        if (pairs.length === 6) warnings.push('Six nouveaux liens piétons proches au maximum sont examinés ; cette sélection ne couvre pas toutes les correspondances possibles.')
        for (const pair of pairs) {
          if (metrics.walkingCalls >= limits.maxWalkRequests) { metrics.walkBudgetReached = true; break }
          try { const path = await walk(pair.a, pair.b); if (path.durationSeconds <= 900 && path.distanceMeters >= 15) verified.push({ from: pair.a.id, to: pair.b.id, path }) }
          catch (error) { signal.throwIfAborted(); const message = `Lien ${pair.a.id} → ${pair.b.id} exclu : ${error instanceof Error ? error.message : 'IGN indisponible'}`; warnings.push(message); providerIssues.push({ source: 'IGN', message }) }
        }
      }
      metrics.walkingWallMs = performance.now() - walkingStart
      metrics.transferWalkingMs = metrics.walkingWallMs - metrics.accessWalkingMs
      const choices: DoorJourney[] = []
      let limited = false, outside = false
      if (origins.length && destinations.length) {
        signal.throwIfAborted()
        await reportStage(progress, 'connections')
        metrics.transitSearches++
        const result = await transit.search({ fromStopId: origins[0].stop.id, toStopId: destinations[0].stop.id, at: query.at, mode: query.mode, order: ['walking', 'waiting'].includes(query.order) ? 'arrival' : query.order as 'arrival', marginSeconds: query.marginSeconds, maxTransfers: query.maxTransfers ?? 2 }, verified, { origins: origins.map(access => ({ id: access.stop.id, seconds: access.path ? access.path.durationSeconds + query.marginSeconds : 0 })), destinations: destinations.map(access => ({ id: access.stop.id, seconds: access.path?.durationSeconds || 0 })) }, signal)
        metrics.sqlMs! += result.metrics.sqlMs || 0; metrics.sqlQueries! += result.metrics.sqlQueries; metrics.routingMs = result.metrics.routingMs || 0; metrics.engineCacheHit = result.metrics.cacheHit
        metrics.transitRoundMs = result.metrics.roundMs; metrics.transitRoundSqlMs = result.metrics.roundSqlMs; metrics.transitRankingMs = result.metrics.rankingMs
        limited ||= result.state === 'limited'; outside ||= result.state === 'outside_validity'
        for (const journey of result.itineraries) {
          const origin = origins.find(access => access.stop.id === journey.legs[0].from.id)!, destination = destinations.find(access => access.stop.id === journey.legs.at(-1)!.to.id)!
          const shift = query.mode === 'departure' ? (origin.path ? origin.path.durationSeconds + query.marginSeconds : 0) : -(destination.path?.durationSeconds || 0)
          const individual = { ...result, itineraries: [journey], query: { ...result.query, fromStopId: origin.stop.id, toStopId: destination.stop.id, at: new Date(Date.parse(query.at) + shift * 1000).toISOString() } }
          const door = doorJourney(query, individual, journey, origin.path, destination.path, from.name, to.name)
          if (query.mode === 'departure' ? Date.parse(door.departureTime) >= Date.parse(query.at) : Date.parse(door.arrivalTime) <= Date.parse(query.at)) choices.push(door)
        }
        warnings.push(...result.warnings)
      }
      await reportStage(progress, 'ranking')
      const rankingStart = performance.now()
      const itineraries = selectDoorJourneys(query, choices)
      metrics.rankingMs = performance.now() - rankingStart
      if (limited) warnings.push('Budget GTFS atteint : comparaison partielle, les propositions affichées restent contrôlées.')
      if (metrics.walkBudgetReached) warnings.push(`Budget de ${limits.maxWalkRequests} demandes piétonnes atteint : les accès restants ne sont pas explorés. Aucun plafond fixe de quatre quais n’est appliqué.`)
      warnings.push('Classement parmi les propositions retenues uniquement, pas de garantie d’optimalité globale. Les attentes non séparables du minimum GTFS restent inconnues.')
      if ((from.address && !origins.length) || (to.address && !destinations.length)) warnings.push('Aucun accès piéton utilisable confirmé pour une adresse. Aucun remplacement à vol d’oiseau.')
      signal.throwIfAborted()
      metrics.durationMs = Math.round((performance.now() - started) * 100) / 100
      Object.assign(metrics, { geocodingMs: trace.geocodingMs, walkingMs: trace.walkingMs, upstreamRequests: trace.upstreamRequests, cacheHits: trace.cacheHits, queueMs: trace.queueMs })
      return { state: limited || metrics.walkBudgetReached ? 'limited' : itineraries.length ? 'ok' : outside ? 'outside_validity' : 'no_journey', itineraries, warnings: [...new Set(warnings)], metrics, providerIssues }
    },
  }
}
