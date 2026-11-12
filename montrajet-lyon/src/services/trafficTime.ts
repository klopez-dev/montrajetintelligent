import type { TrafficIncident } from '../types/traffic.ts'
export function temporalStatus(incident: TrafficIncident, now: number): TrafficIncident['status'] {
  if (incident.temporalPrecision === 'exact' && incident.periods.length) {
    if (incident.periods.some(p => Date.parse(p.start) <= now && (!p.end || now < Date.parse(p.end)))) return 'active'
    if (incident.periods.some(p => Date.parse(p.start) > now)) return 'future'
    return 'ended'
  }
  if (incident.dateBounds && new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)) < incident.dateBounds.start) return 'future'
  return 'undetermined'
}
export function overlaps(incident: TrafficIncident, from: number, until: number): boolean | null {
  if (incident.temporalPrecision !== 'exact' || !incident.periods.length) return null
  return incident.periods.some(p => Date.parse(p.start) <= until && (!p.end || Date.parse(p.end) > from))
}
