/** Modèles de consultation. Les identifiants GTFS restent distincts des noms. */
export interface GtfsLine {
  id: string
  name: string
  shortName: string
  longName: string
  type: number
}
export interface GtfsStop {
  id: string
  name: string
  code: string
  platform: string
  parentId: string
  latitude: number | null
  longitude: number | null
}
export interface GtfsDirection {
  id: string
  headsign: string
}
export interface GtfsService {
  id: string
  startDate: string | null
  endDate: string | null
  /** Du lundi au dimanche. */
  weekdays: number[]
}
export interface GtfsException { serviceId: string; date: string; type: 1 | 2 }
export interface FeedMetadata {
  schemaVersion: 1
  importedAt: string
  sourceUrl: string
  sha256: string
  timezone: string
  validFrom: string
  validUntil: string
  maxDepartureSeconds: number
  files: Record<string, number>
  warnings: string[]
}
export interface TheoreticalPassage {
  tripId: string
  stopId: string
  lineId: string
  directionId: string
  headsign: string
  serviceDate: string
  departureTime: string
  /** Les secondes GTFS peuvent dépasser 86400. */
  gtfsSeconds: number
  kind: 'theoretical'
  interpolated: boolean
  pickupType: number
}
export interface PassageResult {
  queriedAt: string
  passages: TheoreticalPassage[]
  metadata: FeedMetadata
  windowEnd: string
  outsideValidity: boolean
}
