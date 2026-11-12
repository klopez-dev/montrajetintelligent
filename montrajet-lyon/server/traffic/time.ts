import type { TrafficIncident } from '../../src/types/traffic.ts'
import { providerInstant } from '../realtime/time.ts'
import { addDays, parseGtfsDate } from '../gtfs/time.ts'

export function parsePeriod(text: string, title = ''): Pick<TrafficIncident, 'periods' | 'temporalPrecision' | 'dateBounds'> {
  const civil = (d: string) => parseGtfsDate(d.slice(6) + d.slice(3, 5) + d.slice(0, 2))
  const exact = /^Du (\d{2}\/\d{2}\/\d{4}) à (\d{2}:\d{2}) au (\d{2}\/\d{2}\/\d{4}) à (\d{2}:\d{2})$/.exec(text)
  if (exact) {
    const start = providerInstant(`${civil(exact[1])}T${exact[2]}:00`), end = providerInstant(`${civil(exact[3])}T${exact[4]}:00`)
    if (start !== null && end !== null && end > start) return { periods: [{ start: new Date(start).toISOString(), end: new Date(end).toISOString() }], temporalPrecision: 'exact' }
  }
  const recurring = /^Du (\d{2}\/\d{2}\/\d{4}) au (\d{2}\/\d{2}\/\d{4}) De (\d{2}:\d{2}) à (\d{2}:\d{2})$/.exec(text)
  const selected = /^Le ((?:\d{1,2}(?:, | et ))+\d{1,2}) (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) (\d{4})$/.exec(title)
  if (recurring && selected) {
    const month = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'].indexOf(selected[2]) + 1
    const periods = selected[1].split(/, | et /).map(day => {
      try {
        const date = parseGtfsDate(selected[3] + String(month).padStart(2, '0') + day.padStart(2, '0'))
        const endDate = recurring[4] <= recurring[3] ? addDays(date, 1) : date
        if (date < civil(recurring[1]) || endDate > civil(recurring[2])) return null
        const a = providerInstant(`${date}T${recurring[3]}:00`), b = providerInstant(`${endDate}T${recurring[4]}:00`)
        return a !== null && b !== null && b > a ? { start: new Date(a).toISOString(), end: new Date(b).toISOString() } : null
      } catch { return null }
    })
    if (periods.length <= 31 && periods.every(p => p !== null)) return { periods, temporalPrecision: 'exact' }
  }
  const dates = [...text.matchAll(/\b\d{2}\/\d{2}\/\d{4}\b/g)]
  return { periods: [], temporalPrecision: 'text_only', ...(dates.length ? { dateBounds: { start: civil(dates[0][0]) } } : {}) }
}
export { temporalStatus, overlaps } from '../../src/services/trafficTime.ts'
