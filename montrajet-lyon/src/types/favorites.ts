import type { AddressPlace } from './mobility.ts'
export type SavedLocation = AddressPlace | { kind: 'stop'; id: string; name: string; latitude?: number; longitude?: number } | { kind: 'unresolved'; name: string }
export interface FavoritePreferences { mode?: 'departure'|'arrival'; departureTime?: string; arrivalTime?: string; marginSeconds?: number; maxTransfers?: 1|2; walkingTransfers?: boolean; order?: 'arrival'|'departure'|'duration'|'transfers'|'walking'|'waiting' }
export interface FavoritePlace { id: string; name: string; role: 'home'|'work'|'other'; location: SavedLocation; createdAt: string; updatedAt: string }
export type FavoriteEndpoint = { placeId: string } | { location: SavedLocation }
export interface FavoriteTrip { id: string; name: string; from: FavoriteEndpoint; to: FavoriteEndpoint; preferences: FavoritePreferences; createdAt: string; updatedAt: string }
export interface FavoriteStore { version: 2; revision: number; places: FavoritePlace[]; trips: FavoriteTrip[]; preferences: FavoritePreferences }
export interface FavoriteLaunch { id: string; preferences: FavoritePreferences; run: boolean }
