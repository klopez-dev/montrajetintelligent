import type { JourneyStop, RoutingQuery, RoutingResult, TheoreticalJourney } from './journey.ts'

export interface AddressPlace {
  kind: 'address'
  id: string
  name: string
  latitude: number
  longitude: number
  precision: 'housenumber' | 'street'
  source: 'BAN via IGN' | 'OpenStreetMap via Photon'
}
export type JourneyPlace = JourneyStop | AddressPlace
export const isAddress = (place: JourneyPlace): place is AddressPlace => 'kind' in place && place.kind === 'address'
export interface Point { latitude: number; longitude: number }
export interface WalkPath {
  source: 'IGN BD TOPO'
  profile: 'pedestrian'
  resourceVersion: string
  fetchedAt: string
  durationSeconds: number
  distanceMeters: number
  startSnapMeters: number
  endSnapMeters: number
  geometry: { type: 'LineString'; coordinates: [number, number][] }
}
export interface VerifiedTransfer { from: string; to: string; path: WalkPath }
export type PlaceReference = { kind: 'stop'; id: string } | { kind: 'address'; id: string; name: string; expectedCoordinates?: Point }
export interface MobilityQuery {
  from: PlaceReference
  to: PlaceReference
  at: string
  mode: RoutingQuery['mode']
  order: RoutingQuery['order'] | 'walking' | 'waiting'
  marginSeconds: number
  walkingTransfers: boolean
  maxTransfers?: 1 | 2
}
export interface DoorJourney {
  transit: TheoreticalJourney
  access: WalkPath | null
  egress: WalkPath | null
  fromName: string
  toName: string
  departureTime: string
  arrivalTime: string
  durationSeconds: number
  walkingSeconds: number
  waitingSeconds: number | null
  unknownTransferWalking: boolean
  safetySeconds: number
  transitResult: RoutingResult
}
export interface MobilityResult {
  providerIssues?: { source: 'IGN'; message: string }[]
  state: 'ok' | 'no_journey' | 'outside_validity' | 'limited'
  itineraries: DoorJourney[]
  warnings: string[]
  metrics: { durationMs: number; transitSearches: number; walkingCalls: number; sqlMs?: number; sqlQueries?: number; routingMs?: number; geocodingMs?: number; walkingMs?: number; geocodingWallMs?: number; stopsWallMs?: number; walkingWallMs?: number; accessWalkingMs?: number; transferWalkingMs?: number; rankingMs?: number; transitRoundMs?: number[]; transitRoundSqlMs?: number[]; transitRankingMs?: number; upstreamRequests?: number; cacheHits?: number; queueMs?: number; candidatePlatforms?: number; confirmedPlatforms?: number; walkBudgetReached?: boolean; engineCacheHit?: boolean; transferCandidatesMs?: number; transferCandidatesCacheHit?: boolean }
}
