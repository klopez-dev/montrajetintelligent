export interface RealtimeEstimate {
  tripId: string
  lineId: string
  stopId: string
  directionId: string
  headsign: string
  estimatedTime: string
  sourceUpdatedAt: string
  validUntil: string
  kind: 'estimated' | 'theoretical'
  directionReliable?: boolean
  destinationLabel?: string | null
}

export interface MappingStatistics {
  received: number
  matched: number
  rejected: number
  matchRate: number | null
  reasons: Record<string, number>
}

export interface RealtimeResult {
  validationMode?: boolean
  state: 'available' | 'unavailable' | 'no_estimates' | 'stale' | 'not_applicable'
  reason: string
  message: string
  checkedAt: string
  fetchedAt: string | null
  sourceUpdatedAt: string | null
  estimates: RealtimeEstimate[]
  mapping: MappingStatistics | null
}
