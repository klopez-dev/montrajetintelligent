import type { FeedMetadata, GtfsStop } from './gtfs.ts'
import type { AddressPlace, WalkPath } from './mobility.ts'

export type JourneyOrder = 'arrival' | 'departure' | 'duration' | 'transfers'
export interface JourneyDraft { departure: string; arrival: string; departureStopId?: string; arrivalStopId?: string; departureAddress?: AddressPlace; arrivalAddress?: AddressPlace }
export interface RoutingQuery {
  fromStopId: string
  toStopId: string
  at: string
  mode: 'departure' | 'arrival'
  marginSeconds: number
  order: JourneyOrder
  maxTransfers?: 1 | 2
}
export interface JourneyStop extends GtfsStop { lines: { id: string; name: string }[] }
export interface RideLeg {
  tripId: string
  serviceDate: string
  routeId: string
  lineName: string
  routeType: number
  directionId: string
  headsign: string
  from: { id: string; name: string; sequence: number }
  to: { id: string; name: string; sequence: number }
  departureTime: string
  arrivalTime: string
  departureGtfsSeconds: number
  arrivalGtfsSeconds: number
  interpolatedBySource: boolean
}
export interface JourneyTransfer {
  fromStopId: string
  fromStopName: string
  toStopId: string
  toStopName: string
  ruleId: number | null
  source: 'gtfs' | 'same_platform_assumption' | 'ign_pedestrian'
  walkingPath?: WalkPath
  officialMinimumSeconds: number
  marginSeconds: number
  requiredSeconds: number
  intervalSeconds: number
  spareSeconds: number
  /** Le minimum requis retient le maximum du minimum GTFS et de la marche vérifiée. */
  walkingSeconds: number | null
}
export interface TheoreticalJourney {
  id: string
  departureTime: string
  arrivalTime: string
  durationSeconds: number
  initialWaitSeconds: number
  transfers: number
  legs: RideLeg[]
  connection: JourneyTransfer | null
  connections?: JourneyTransfer[]
  kind: 'theoretical'
}
export interface RoutingResult {
  state: 'ok' | 'no_journey' | 'outside_validity' | 'limited'
  query: RoutingQuery
  itineraries: TheoreticalJourney[]
  metadata: FeedMetadata
  scope: { maxTransfers: 1 | 2; windowHours: 6; from: string; until: string; marginSeconds: number }
  metrics: { durationMs: number; sqlQueries: number; legCount: number; transferPairs: number; candidateCount: number; coldTopology: boolean; sqlMs?: number; routingMs?: number; cacheHit?: boolean; rounds?: number; limited?: boolean; topologyMs?: number; roundMs?: number[]; roundSqlMs?: number[]; rankingMs?: number }
  warnings: string[]
}
