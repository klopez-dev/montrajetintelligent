export type TrafficMode = 'bus' | 'metro' | 'tram' | 'funicular'
export type Precision = 'exact' | 'partial' | 'unmatched'
export interface TrafficReference {
  sourceId?: string
  label: string
  mode?: TrafficMode
  gtfsIds: string[]
  precision: Precision
  /** Exact matches require a documented shared identifier namespace. */
  namespace?: 'gtfs' | 'tcl-web'
}
export interface TrafficPeriod { start: string; end?: string }
export interface TrafficCoverage {
  line: string
  mode?: TrafficMode
  state: 'with_announcements' | 'without_announcements' | 'not_checked' | 'failed' | 'stale'
  sourceUrl?: string
  lastAttemptAt?: string
  lastSuccessAt?: string
  validUntil?: string
  announcementCount?: number
  error?: string
}
export interface TrafficIncident {
  id: string
  identity: 'official' | 'content-derived'
  producer: { id: string; name: string }
  sourceUrl: string
  relatedUrls: string[]
  fetchedAt: string
  publishedAt?: string
  updatedAt?: string
  title: string
  description: string
  type: 'works' | 'interruption' | 'diversion' | 'stop_closed' | 'information' | 'other'
  officialSeverity?: string
  lines: TrafficReference[]
  directions?: string[]
  /** Literal excerpts, not GTFS platform identifiers. */
  explicitDetails?: { kind: 'direction' | 'unserved' | 'relocated' | 'replacement' | 'diversion' | 'frequency'; text: string }[]
  recurrenceText?: string
  directionIds?: string[]
  stops?: TrafficReference[]
  removedStops?: TrafficReference[]
  replacementStops?: TrafficReference[]
  replacementRoute?: string
  periods: TrafficPeriod[]
  /** Original wording, including unparsed recurrences. Never expand a vague range. */
  periodText?: string
  dateBounds?: { start: string; end?: string }
  temporalPrecision: 'exact' | 'text_only'
  status: 'active' | 'future' | 'ended' | 'undetermined'
  mapping: Precision
}
export interface TrafficSnapshot {
  state: 'available' | 'stale' | 'unavailable'
  partial: true
  incidents: TrafficIncident[]
  fetchedAt?: string
  checkedAt: string
  policyCheckedAt?: string
  validUntil?: string
  error?: string
  coverage: string[]
  lineCoverage?: TrafficCoverage[]
  discoveredLines?: { line: string; mode: TrafficMode; url: string }[]
  coverageSummary?: { total: number; verified: number; withAnnouncements: number; withoutAnnouncements: number; notChecked: number; failed: number; stale: number }
  sourceUrl: string
  metrics: { upstreamRequests: number; totalUpstreamRequests?: number; cacheHit: boolean; durationMs: number }
}
export interface JourneyTrafficNotice {
  incidentId: string
  level: 'confirmed' | 'possible' | 'general'
  title: string
  sourceUrl: string
  legIndex: number
  reason: string
}
