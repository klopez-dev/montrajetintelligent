import { createSharedSearch } from '../search/shared.ts'
import { searchStream, wantsSearchStream } from '../search/stream.ts'
import type { ProgressObserver } from '../../src/types/searchProgress.ts'
import type { RoutingResult } from '../../src/types/journey.ts'
import type { QueryDatabase } from '../gtfs/repository.ts'
import { searchStops } from '../gtfs/repository.ts'
import { parseGtfsDate } from '../gtfs/time.ts'
import { createJourneyPlanner } from './planner.ts'
import type { JourneyOrder, JourneyStop, RoutingQuery } from '../../src/types/journey.ts'
import type { RoutingLimits } from './limits.ts'

const planners = new WeakMap<QueryDatabase, ReturnType<typeof createJourneyPlanner>>()
const jobs = new WeakMap<QueryDatabase, ReturnType<typeof createSharedSearch<RoutingResult>>>()
export async function handleJourneyRequest(request: Request, db: QueryDatabase | null, limits?: RoutingLimits, progress?: ProgressObserver, signal: AbortSignal = request.signal): Promise<Response> {
  if (!progress && wantsSearchStream(request) && new URL(request.url).pathname === '/api/journeys/search') return searchStream(request, (signal, observer) => handleJourneyRequest(request, db, limits, observer, signal))
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
  if (request.method !== 'GET') return json({ error: 'Méthode non autorisée.' }, 405)
  const url = new URL(request.url)
  if (!['/api/journeys/search', '/api/journeys/stops'].includes(url.pathname)) return json({ error: 'Ressource inconnue.' }, 404)
  if (!db) return json({ error: 'La base GTFS nécessaire au calcul n’est pas disponible.' }, 503)
  try {
    function param(name: string) { const value = url.searchParams.get(name)?.trim() || ''; if (value.length > 200) throw new Error('Paramètre trop long.'); return value }
    if (url.pathname.endsWith('/stops')) {
      const id = param('id')
      const stops = id ? await db.all<JourneyStop>(`SELECT id,name,code,platform,parent_id AS parentId,latitude,longitude FROM stops WHERE id=? AND location_type=0`, [id]) : await searchStops(db, param('q'))
      const routes = stops.length ? await db.all<{ stopId: string; id: string; name: string }>(`
        SELECT rs.stop_id AS stopId,r.id,CASE WHEN r.short_name<>'' THEN r.short_name ELSE r.long_name END AS name
        FROM route_stops rs JOIN routes r ON r.id=rs.route_id WHERE rs.stop_id IN(SELECT value FROM json_each(?)) ORDER BY r.short_name,r.id
      `, [JSON.stringify(stops.map(stop => stop.id))]) : []
      const data: JourneyStop[] = stops.map(stop => ({ ...stop, lines: routes.filter(route => route.stopId === stop.id).map(({ id, name }) => ({ id, name })) }))
      return json({ status: 'connected', data })
    }
    const fromStopId = param('fromStopId'), toStopId = param('toStopId'), at = param('at')
    const mode = param('mode') || 'departure'
    const marginText = param('marginSeconds') || '120'
    const order = param('order') || (mode === 'arrival' ? 'departure' : 'arrival')
    const maxTransfers = param('maxTransfers') || '2'
    if (!['1', '2'].includes(maxTransfers)) throw new Error('Choisissez une ou deux correspondances maximum.')
    if (!fromStopId || !toStopId) throw new Error('Sélectionnez un arrêt de départ et un arrêt d’arrivée.')
    if (!['departure', 'arrival'].includes(mode)) throw new Error('Mode de recherche invalide.')
    if (!['arrival', 'departure', 'duration', 'transfers'].includes(order)) throw new Error('Classement invalide.')
    if (!/^\d+$/.test(marginText) || Number(marginText) < 30 || Number(marginText) > 1800) throw new Error('La marge doit être comprise entre 30 et 1800 secondes.')
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at))) throw new Error('Choisissez un instant ISO avec fuseau horaire.')
    try { parseGtfsDate(at.slice(0, 10).replaceAll('-', '')) } catch { throw new Error('La date choisie est invalide.') }
    const query: RoutingQuery = { fromStopId, toStopId, at, mode: mode as RoutingQuery['mode'], marginSeconds: Number(marginText), order: order as JourneyOrder, maxTransfers: Number(maxTransfers) as 1 | 2 }
    let planner = planners.get(db)
    if (!planner) { planner = createJourneyPlanner(db, limits); planners.set(db, planner) }
    let shared = jobs.get(db)
    if (!shared) { shared = createSharedSearch<RoutingResult>(); jobs.set(db, shared) }
    return json({ status: 'connected', data: await shared.run(JSON.stringify(query), (workSignal, emit) => planner!.search(query, [], undefined, workSignal, emit), signal, progress) })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const inputError = /Paramètre|Sélectionnez|départ et l’arrivée|Mode de|Classement|marge doit|Choisissez|date choisie/.test(message)
    if (inputError) return json({ error: message }, 400)
    console.error('Calcul GTFS indisponible', error)
    return json({ error: 'Le calcul théorique est indisponible. Aucun itinéraire de remplacement n’a été inventé.' }, 503)
  }
}
