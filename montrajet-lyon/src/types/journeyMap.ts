export type Coordinate = [number, number]
export interface MapStop { id: string; name: string; sequence: number; longitude: number | null; latitude: number | null }
export interface MapLegReference { tripId: string; fromSequence: number; toSequence: number; fromStopId: string; toStopId: string }
export interface TransitMapLeg { tripId: string; routeId: string; lineName: string; routeType: number; headsign: string; stops: MapStop[]; color: string | null; geometry: null; geometryStatus: 'unavailable' }
export interface TransitMapResponse { feedSha256: string; legs: TransitMapLeg[]; durationMs: number; warning: string }
export interface MapStep { id: string; kind: 'ride' | 'walk' | 'transfer'; title: string; description: string; points: { coordinate: Coordinate; label: string }[]; geometry: { type: 'LineString'; coordinates: Coordinate[] } | null; color: string; geometrySource: string }
