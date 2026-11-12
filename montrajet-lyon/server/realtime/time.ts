/** Les horodatages explicites sont préférés. Pour une date locale Europe/Paris,
 * on refuse les heures inexistantes OU ambiguës plutôt que choisir un décalage.
 * Ce ne sont pas les durées de jour de service utilisées par le GTFS statique.
 */
export function providerInstant(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ]([0-2]\d):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})?$/.exec(value)
  if (!match || Number(match[4]) > 23) return null
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]), Number((match[7] || '').padEnd(3, '0')))
  const civil = new Date(wall).toISOString()
  if (civil.slice(0, 10) !== `${match[1]}-${match[2]}-${match[3]}`) return null
  if (match[8]) {
    const parsed = Date.parse(value.replace(' ', 'T'))
    return Number.isFinite(parsed) ? parsed : null
  }
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  const candidates = [wall - 3600000, wall - 7200000].filter(instant => {
    const p = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]))
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}` === value.slice(0, 19).replace('T', ' ')
  })
  return candidates.length === 1 ? candidates[0] : null
}
