/** Résout un datetime-local dans le fuseau de l'appareil sans normaliser une
 * heure inexistante. Les deux occurrences d'une heure répétée sont conservées.
 */
export function localDateCandidates(value: string): number[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return []
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return []
  const format = (instant: number) => {
    const d = new Date(instant)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return [-7200000, -3600000, 0, 3600000, 7200000].map(offset => date.getTime() + offset).filter(instant => format(instant) === value).sort((a, b) => a - b)
}
