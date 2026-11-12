import type { TheoreticalPassage } from '../types/gtfs.ts'

/** Une consultation datée est un instantané. En mode maintenant, aucun départ
 * passé ne reste dans la liste ; retirer un résultat n'en invente aucun autre.
 */
export function visiblePassages(passages: TheoreticalPassage[], fixedDate: boolean, now: number): TheoreticalPassage[] {
  return fixedDate ? passages : passages.filter(p => Date.parse(p.departureTime) >= now)
}

export function nextExpiration(passages: TheoreticalPassage[], now: number): number | null {
  const next = passages.map(p => Date.parse(p.departureTime)).filter(time => time >= now)
  return next.length ? Math.min(...next) + 1 : null
}
