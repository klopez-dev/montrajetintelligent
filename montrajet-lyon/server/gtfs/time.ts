import type { GtfsService } from '../../src/types/gtfs.ts'

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function parseGtfsDate(value: string): string {
  if (!/^\d{8}$/.test(value)) throw new Error(`Date GTFS invalide : ${value}`)
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
  const date = new Date(`${iso}T12:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new Error(`Date GTFS invalide : ${value}`)
  }
  return iso
}

export function parseGtfsTime(value: string): number {
  const match = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value)
  if (!match) throw new Error(`Heure GTFS invalide : ${value}`)
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

export function addDays(isoDate: string, count: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

export function serviceActive(service: GtfsService | undefined, date: string, exception?: number): boolean {
  if (exception !== undefined) return exception === 1
  if (!service?.startDate || !service.endDate || date < service.startDate || date > service.endDate) return false
  const weekday = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7
  return service.weekdays[weekday] === 1
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(timezone: string) {
  let value = formatters.get(timezone)
  if (!value) {
    value = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    formatters.set(timezone, value)
  }
  return value
}
function localParts(instant: number, timezone: string) {
  return Object.fromEntries(formatter(timezone).formatToParts(new Date(instant)).map(p => [p.type, p.value]))
}
export function localServiceDate(instant: number, timezone: string): string {
  const parts = localParts(instant, timezone)
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** GTFS : midi local du jour de service moins 12 heures réelles, puis durée GTFS.
 * Ne pas construire un minuit local : cela décale les départs aux changements d'heure.
 */
export function serviceDayOrigin(date: string, timezone: string): number {
  const noonUtc = Date.parse(`${date}T12:00:00Z`)
  let localNoon = noonUtc
  for (let i = 0; i < 3; i++) {
    const p = localParts(localNoon, timezone)
    const observed = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`)
    localNoon += noonUtc - observed
  }
  return localNoon - 12 * 3600_000
}
