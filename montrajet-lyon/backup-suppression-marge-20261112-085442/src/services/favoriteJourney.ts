import type { FavoritePreferences, SavedLocation } from '../types/favorites.ts'
import type { MobilityQuery } from '../types/mobility.ts'

export interface JourneyFormSettings { mode: 'departure'|'arrival'; dateTime: string; fold: string; order: MobilityQuery['order']; margin: string; maxTransfers: '1'|'2'; walkingTransfers: boolean }
export function defaultJourneySettings(): JourneyFormSettings {
  const d = new Date(), dateTime = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
  return { mode:'departure', dateTime, fold:'0', order:'arrival', margin:'120', maxTransfers:'2', walkingTransfers:false }
}

/** Keep the selected day, never save/reuse a computed itinerary or an old date. */
export function favoriteSchedule(currentDateTime: string, current: FavoritePreferences, saved: FavoritePreferences) {
  const preferences = { ...current, ...saved }, hour = preferences.mode === 'arrival' ? saved.arrivalTime : saved.departureTime
  return { preferences, dateTime: hour ? currentDateTime.slice(0,11) + hour : currentDateTime }
}
export function usableFavoriteLocation(location: SavedLocation | undefined): string {
  return !location || location.kind === 'unresolved' ? 'Ce favori ne contient pas de localisation validée. Sélectionnez à nouveau le lieu dans Modifier.' : ''
}
