import { getDirections, getMetadata, getPassages, searchLines, searchStops } from './repository.ts'
import type { QueryDatabase } from './repository.ts'
import { parseGtfsDate } from './time.ts'

export const missingFeedMessage = 'Données GTFS non connectées. Déposez GTFS_TCL.ZIP dans data/gtfs/ puis exécutez npm run gtfs:import côté projet.'
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } })
}
function parameter(url: URL, name: string, required = false): string {
  const value = url.searchParams.get(name)?.trim() || ''
  if (value.length > 200 || (required && !value)) throw new Error(`Paramètre invalide : ${name}`)
  return value
}

/** API identique sous Vite et dans une Function Cloudflare Pages. */
export async function handleGtfsRequest(request: Request, db: QueryDatabase | null, now = Date.now()): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Méthode non autorisée.' }, 405)
  const url = new URL(request.url)
  const action = url.pathname.replace(/^\/api\/gtfs\/?/, '')
  if (!['status', 'lines', 'stops', 'directions', 'passages'].includes(action)) return json({ error: 'Ressource inconnue.' }, 404)
  if (!db) return json({ status: 'disconnected', message: missingFeedMessage }, 503)
  try {
    // Validation des entrées avant toute requête coûteuse.
    const q = parameter(url, 'q')
    const lineId = parameter(url, 'lineId', ['passages', 'directions'].includes(action))
    const stopId = parameter(url, 'stopId', ['passages', 'directions'].includes(action))
    const direction = url.searchParams.has('direction') ? parameter(url, 'direction') : undefined
    if (direction !== undefined && !['', '0', '1'].includes(direction)) throw new Error('Direction invalide.')
    const at = parameter(url, 'at')
    if (at && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(Date.parse(at)))) throw new Error('La date doit être un instant ISO avec fuseau.')
    if (at) {
      try { parseGtfsDate(at.slice(0, 10).replaceAll('-', '')) }
      catch { throw new Error('La date doit être un jour civil valide.') }
    }
    let data: unknown
    switch (action) {
      case 'status': data = await getMetadata(db); break
      case 'lines': data = await searchLines(db, q); break
      case 'stops': data = await searchStops(db, q, lineId); break
      case 'directions': data = await getDirections(db, lineId, stopId); break
      case 'passages': data = await getPassages(db, lineId, stopId, at ? Date.parse(at) : now, direction); break
    }
    return json({ status: 'connected', data })
  } catch (error) {
    if (error instanceof Error && /Paramètre invalide|Direction invalide|date doit/.test(error.message)) return json({ error: error.message }, 400)
    console.error('Erreur de consultation GTFS', error)
    return json({ status: 'disconnected', message: 'La base GTFS est indisponible ou incompatible. Vérifiez le rapport d’import côté serveur.' }, 503)
  }
}
