import type { Disruption, ServiceResult } from '../types/transport'
import type { GtfsLine, GtfsStop, PassageResult } from '../types/gtfs'
import type { RoutingQuery, RoutingResult } from '../types/journey'
import { gtfsApi } from './gtfs.ts'
import { journeysApi } from './journeys.ts'
export interface TransportServices {
  gtfs: { searchStops(query: string, lineId?: string): Promise<ServiceResult<GtfsStop[]>>; searchLines(query: string): Promise<ServiceResult<GtfsLine[]>> }
  passages: { get(line: string, stop: string): Promise<ServiceResult<PassageResult>> }
  disruptions: { get(): Promise<ServiceResult<Disruption[]>> }
  journeys: { search(query: RoutingQuery): Promise<ServiceResult<RoutingResult>> }
}
const unavailable = async <T>(message: string): Promise<ServiceResult<T>> => ({ status: 'disconnected', message })
export const transportServices: TransportServices = {
  gtfs: { searchStops: gtfsApi.searchStops, searchLines: gtfsApi.searchLines },
  passages: { get: gtfsApi.passages },
  disruptions: { get: () => unavailable('La source officielle des perturbations n’est pas encore connectée.') },
  journeys: { search: journeysApi.search },
}
