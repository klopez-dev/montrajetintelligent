import type { TrafficCoverage, TrafficSnapshot } from '../types/traffic.ts'

export function coverageAt(rows: TrafficCoverage[], now: number): TrafficCoverage[] {
  return rows.map(row => row.lastSuccessAt && row.validUntil && now >= Date.parse(row.validUntil) ? { ...row, state: 'stale' } : row)
}
export function coverageSummary(rows: TrafficCoverage[]): NonNullable<TrafficSnapshot['coverageSummary']> {
  const count = (state: TrafficCoverage['state']) => rows.filter(row => row.state === state).length
  return { total: rows.length, verified: count('with_announcements') + count('without_announcements'), withAnnouncements: count('with_announcements'), withoutAnnouncements: count('without_announcements'), notChecked: count('not_checked'), failed: count('failed'), stale: count('stale') }
}
