import { createSharedSearch } from '../search/shared.ts'
import { searchStream, wantsSearchStream } from '../search/stream.ts'
import type { ProgressObserver } from '../../src/types/searchProgress.ts'
import type { MobilityResult } from '../../src/types/mobility.ts'
import type { QueryDatabase } from '../gtfs/repository.ts'
import { parseGtfsDate } from '../gtfs/time.ts'
import type { MobilityQuery, PlaceReference } from '../../src/types/mobility.ts'
import { GeographicError } from './provider.ts'
import { createHybridGeographicProvider } from './hybrid.ts'
import type { GeographicProvider } from './provider.ts'
import { createMobilityPlanner } from './planner.ts'
import { defaultRoutingLimits } from '../journeys/limits.ts'
import type { RoutingLimits } from '../journeys/limits.ts'

export function createMobilityApi(provider: GeographicProvider = createHybridGeographicProvider(), limits: RoutingLimits = defaultRoutingLimits) {
  const planners = new WeakMap<QueryDatabase, ReturnType<typeof createMobilityPlanner>>()
  const jobs = new WeakMap<QueryDatabase, ReturnType<typeof createSharedSearch<MobilityResult>>>()
  const execute = async (request: Request, db: QueryDatabase | null, progress?: ProgressObserver, signal: AbortSignal = request.signal): Promise<Response> => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
    const url = new URL(request.url)
    try {
      if (url.pathname === '/api/mobility/addresses') {
        if (request.method !== 'GET') return json({ error: 'Méthode non autorisée.' }, 405)
        const q = url.searchParams.get('q')?.trim() || ''
        if (q.length > 160) return json({ error: 'Recherche trop longue.' }, 400)
        return json({ status: 'connected', data: await provider.addresses(q, undefined, signal) })
      }
      if (url.pathname !== '/api/mobility/search') return json({ error: 'Ressource inconnue.' }, 404)
      if (request.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405)
      if (!db) return json({ error: 'Base GTFS indisponible.' }, 503)
      const text = await request.text()
      if (text.length > 4096) return json({ error: 'Recherche trop volumineuse.' }, 413)
      let query: MobilityQuery
      try {
        query = JSON.parse(text)
        if (query.maxTransfers !== undefined && ![1, 2].includes(query.maxTransfers)) throw new Error('input')
        const place = (value: PlaceReference) => value && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 160 && (value.kind === 'stop' || value.kind === 'address' && typeof value.name === 'string' && value.name.length >= 3 && value.name.length <= 160 && (value.expectedCoordinates === undefined || value.expectedCoordinates && Number.isFinite(value.expectedCoordinates.latitude) && Math.abs(value.expectedCoordinates.latitude) <= 90 && Number.isFinite(value.expectedCoordinates.longitude) && Math.abs(value.expectedCoordinates.longitude) <= 180))
        if (!place(query.from) || !place(query.to) || !['departure', 'arrival'].includes(query.mode) || !['arrival', 'departure', 'duration', 'transfers', 'walking', 'waiting'].includes(query.order) || !Number.isInteger(query.marginSeconds) || query.marginSeconds < 0 || query.marginSeconds > 1800 || typeof query.walkingTransfers !== 'boolean' || typeof query.at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(query.at) || !Number.isFinite(Date.parse(query.at))) throw new Error('input')
        parseGtfsDate(query.at.slice(0, 10).replaceAll('-', ''))
        query.marginSeconds = 0 // Compatibilité : les anciennes marges sont ignorées.
        if (query.from.kind === query.to.kind && query.from.id === query.to.id) throw new Error('same')
      } catch { return json({ error: 'Sélectionnez deux lieux distincts et des paramètres de recherche valides.' }, 400) }
      let planner = planners.get(db)
      if (!planner) { planner = createMobilityPlanner(db, provider, limits); planners.set(db, planner) }
      let shared = jobs.get(db)
      if (!shared) { shared = createSharedSearch<MobilityResult>(); jobs.set(db, shared) }
      const ref = (p: PlaceReference) => p.kind === 'address' ? { kind: p.kind, id: p.id, name: p.name, expectedCoordinates: p.expectedCoordinates } : { kind: p.kind, id: p.id }
      const key = JSON.stringify({ from: ref(query.from), to: ref(query.to), at: query.at, mode: query.mode, order: query.order, margin: query.marginSeconds, max: query.maxTransfers ?? 2, walking: query.walkingTransfers })
      return json({ status: 'connected', data: await shared.run(key, (workSignal, emit) => planner!.search(query, AbortSignal.any([workSignal, AbortSignal.timeout(limits.deadlineMs)]), emit), signal, progress) })
    } catch (error) {
      // No addresses, coordinates or provider payloads in application logs.
      return json({ error: error instanceof GeographicError ? error.message : 'Calcul porte-à-porte indisponible ou délai dépassé. Aucun accès piéton inventé.' }, 503)
    }
  }
  return (request: Request, db: QueryDatabase | null): Promise<Response> => wantsSearchStream(request) && new URL(request.url).pathname === '/api/mobility/search'
    ? Promise.resolve(searchStream(request, (signal, observer) => execute(request, db, observer, signal)))
    : execute(request, db)
}
