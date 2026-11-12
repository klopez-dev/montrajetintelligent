import { coverageAt, coverageSummary } from '../../src/services/trafficCoverage.ts'
import type { TrafficCoverage } from '../../src/types/traffic.ts'
import type { TrafficProvider } from './provider.ts'
import { createTrafficProvider } from './provider.ts'
import type { QueryDatabase } from '../gtfs/repository.ts'
import { getMetadata } from '../gtfs/repository.ts'
import { mapIncidents, matchJourney, routeMode } from './matching.ts'
import type { AffectedLeg } from './matching.ts'
import { temporalStatus, overlaps } from './time.ts'
import { parseGtfsDate, serviceDayOrigin, serviceActive, localServiceDate } from '../gtfs/time.ts'
import { providerInstant } from '../realtime/time.ts'
import type { RideLeg } from '../../src/types/journey.ts'
import type { GtfsService } from '../../src/types/gtfs.ts'

export function createTrafficApi(provider: TrafficProvider = createTrafficProvider()) {
  return async (request: Request, db: QueryDatabase | null): Promise<Response> => {
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
    const url = new URL(request.url)
    if (!['/api/traffic', '/api/traffic/journeys'].includes(url.pathname)) return json({ error: 'Ressource trafic inconnue.' }, 404)
    if (request.method !== (url.pathname.endsWith('/journeys') ? 'POST' : 'GET')) return json({ error: 'Méthode non autorisée.' }, 405)
    try {
      const line = url.searchParams.get('line') || '', mode = url.searchParams.get('mode') || '', date = url.searchParams.get('date') || ''
      if (line.length > 30 || !['', 'bus', 'metro', 'tram', 'funicular'].includes(mode)) return json({ error: 'Filtre trafic invalide.' }, 400)
      if (date) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: 'Date trafic invalide.' }, 400); try { parseGtfsDate(date.replaceAll('-', '')) } catch { return json({ error: 'Date trafic invalide.' }, 400) } }
      let journeys: RideLeg[][] | undefined
      if (request.method === 'POST') {
        const raw = await request.text()
        if (raw.length > 32000) return json({ error: 'Requête trafic trop volumineuse.' }, 413)
        try { journeys = JSON.parse(raw).journeys; if (!Array.isArray(journeys) || journeys.length > 6 || journeys.some(j => !Array.isArray(j) || !j.length || j.length > 3 || j.some(l => typeof l.tripId !== 'string' || l.tripId.length > 160 || !/^\d{4}-\d{2}-\d{2}$/.test(l.serviceDate) || !Number.isInteger(l.from?.sequence) || !Number.isInteger(l.to?.sequence) || l.from.sequence >= l.to.sequence))) throw new Error() }
        catch { return json({ error: 'Tronçons GTFS invalides.' }, 400) }
      }
      const catalogueRows = db ? await db.all<{ line: string; type: number }>("SELECT DISTINCT short_name AS line,type FROM routes WHERE short_name<>'' ORDER BY short_name,type") : []
      const allCatalogue = catalogueRows.map(r => ({ line: r.line, mode: routeMode(r.type) })).filter((r, i, all) => all.findIndex(p => p.line === r.line && p.mode === r.mode) === i)
      const catalogue = catalogueRows.flatMap(r => { const mode = routeMode(r.type); return mode ? [{ line: r.line, mode }] : [] }).filter((r, i, all) => all.findIndex(p => p.line === r.line && p.mode === r.mode) === i)
      const snapshot = await provider.get(catalogue)
      const sourceRows = coverageAt(snapshot.lineCoverage || [], Date.now())
      const lineCoverage: TrafficCoverage[] = allCatalogue.length ? allCatalogue.map(r => sourceRows.find(s => s.line === r.line && (!s.mode || s.mode === r.mode)) || { ...r, state: 'not_checked' as const }) : sourceRows
      const freshLines = new Set(sourceRows.filter(r => ['with_announcements','without_announcements'].includes(r.state)).map(r => r.line))
      const incidents = db ? await mapIncidents(db, snapshot.incidents) : snapshot.incidents
      const now = Date.now(), dayStart = date ? providerInstant(date + 'T00:00:00')! : 0
      const tomorrow = date ? new Date(Date.parse(date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10) : ''
      const dayEnd = date ? providerInstant(tomorrow + 'T00:00:00')! : 0
      const data = { ...snapshot, lineCoverage, coverageSummary: coverageSummary(lineCoverage), gtfsConnected: Boolean(db), incidents: incidents.map(i => ({ ...i, status: temporalStatus(i, now) })).filter(i => (!line || i.lines.some(l => l.label.toUpperCase() === line.toUpperCase())) && (!mode || i.lines.some(l => l.mode === mode)) && (!date || overlaps(i, dayStart, dayEnd - 1) !== false)) }
      if (!journeys) return json({ status: 'connected', data })
      if (!db) return json({ status: 'connected', data: { ...data, notices: [], matchingUnavailable: true } })
      const metadata = await getMetadata(db)
      const notices = []
      for (const journey of journeys) {
        const legs: AffectedLeg[] = []
        for (const leg of journey) {
          try { parseGtfsDate(leg.serviceDate.replaceAll('-', '')) } catch { return json({ error: 'Jour de service invalide.' }, 400) }
          if (leg.serviceDate < metadata.validFrom || leg.serviceDate > metadata.validUntil) return json({ error: 'Jour hors validité GTFS.' }, 400)
          const rows = await db.all<{ stopId: string; departure: number; arrival: number; routeId: string; directionId: string; serviceId: string }>('SELECT st.stop_id AS stopId,st.departure,st.arrival,t.route_id AS routeId,t.direction_id AS directionId,t.service_id AS serviceId FROM stop_times st JOIN trips t ON t.id=st.trip_id WHERE t.id=? AND st.sequence BETWEEN ? AND ? ORDER BY st.sequence', [leg.tripId, leg.from.sequence, leg.to.sequence])
          if (rows.length < 2 || rows[0].stopId !== leg.from.id || rows.at(-1)!.stopId !== leg.to.id || rows.some(r => !Number.isFinite(r.arrival) || !Number.isFinite(r.departure))) return json({ error: 'Tronçon absent du GTFS.' }, 400)
          const [service] = await db.all<GtfsService>('SELECT id,start_date AS startDate,end_date AS endDate,json_array(monday,tuesday,wednesday,thursday,friday,saturday,sunday) AS weekdays FROM services WHERE id=?', [rows[0].serviceId])
          if (service && typeof service.weekdays === 'string') service.weekdays = JSON.parse(service.weekdays)
          const [exception] = await db.all<{ value: number }>('SELECT exception_type AS value FROM calendar_dates WHERE service_id=? AND date=?', [rows[0].serviceId, leg.serviceDate])
          if (!serviceActive(service, leg.serviceDate, exception?.value)) return json({ error: 'Service GTFS inactif.' }, 400)
          const origin = serviceDayOrigin(leg.serviceDate, metadata.timezone)
          legs.push({ routeId: rows[0].routeId, directionId: rows[0].directionId, start: origin + rows[0].departure * 1000, end: origin + rows.at(-1)!.arrival * 1000, stops: rows.map((r, index) => ({ id: r.stopId, at: origin + (index === 0 ? r.departure : r.arrival) * 1000 })) })
        }
        notices.push(snapshot.state === 'available' ? matchJourney(snapshot.lineCoverage ? incidents.map(i => ({ ...i, lines: i.lines.filter(l => freshLines.has(l.label)) })).filter(i => i.lines.length) : incidents, legs) : [])
      }
      return json({ status: 'connected', data: { ...data, notices, matchingUnavailable: snapshot.state !== 'available', checkedServiceDate: localServiceDate(now, 'Europe/Paris') } })
    } catch { return json({ error: 'Vérification du trafic TCL indisponible. L’absence de données ne prouve pas l’absence de perturbation.' }, 503) }
  }
}
