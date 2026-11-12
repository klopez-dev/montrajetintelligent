export interface Favorite { id: string; departure: string; arrival: string; departureStopId?: string; arrivalStopId?: string }
export interface JourneyQuery { departure: string; arrival: string; dateTime: string; mode: 'departure' | 'arrival' }
export interface Journey { id: string; departureTime: string; arrivalTime: string }
export interface Stop { id: string; name: string }
export interface Line { id: string; name: string }
export interface Passage { lineId: string; stopId: string; time: string; kind: 'theoretical' | 'realtime' }
export interface Disruption { id: string; title: string; description: string; lineIds: string[] }
export type ServiceResult<T> = { status: 'connected'; data: T; warning?: string } | { status: 'disconnected'; message: string }

