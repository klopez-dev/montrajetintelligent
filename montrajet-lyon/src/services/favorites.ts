import type { Favorite } from '../types/transport.ts'
import type { FavoriteStore, FavoritePreferences, SavedLocation, FavoriteEndpoint, FavoritePlace, FavoriteTrip } from '../types/favorites.ts'
import type { JourneyPlace } from '../types/mobility.ts'
import { isAddress } from '../types/mobility.ts'
import type { JourneyDraft } from '../types/journey.ts'

// A single canonical key, unchanged from V0.1. Reading never mutates user data.
export const favoritesKey = 'montrajet-lyon:favorites:v1'
export const emptyFavoriteStore = (): FavoriteStore => ({ version: 2, revision: 0, places: [], trips: [], preferences: {} })
const str = (v: unknown, max = 160): v is string => typeof v === 'string' && !!v.trim() && v.length <= max
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v))
const point = (a: unknown, b: unknown) => typeof a === 'number' && Number.isFinite(a) && Math.abs(a) <= 90 && typeof b === 'number' && Number.isFinite(b) && Math.abs(b) <= 180
const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Données de favoris invalides.'); return v as Record<string, unknown> }
export function parseLocation(value: unknown): SavedLocation {
  const v = obj(value)
  if (!str(v.name)) throw new Error('Libellé du lieu invalide.')
  if (v.kind === 'unresolved') return { kind: 'unresolved', name: v.name }
  if (!str(v.id)) throw new Error('Identifiant du lieu invalide.')
  if (v.kind === 'address') {
    if (!v.id.startsWith('address:') || v.id.length < 9 || v.precision !== 'housenumber' || !['BAN via IGN', 'OpenStreetMap via Photon'].includes(String(v.source)) || !point(v.latitude,v.longitude)) throw new Error('Adresse inutilisable : sélectionnez une adresse avec numéro et coordonnées valides.')
    return { kind: 'address', id: v.id, name: v.name, latitude: v.latitude as number, longitude: v.longitude as number, precision: 'housenumber', source: v.source as 'BAN via IGN' | 'OpenStreetMap via Photon' }
  }
  if (v.kind !== 'stop' || (v.latitude !== undefined || v.longitude !== undefined) && !point(v.latitude,v.longitude)) throw new Error('Quai enregistré invalide.')
  return { kind: 'stop', id: v.id, name: v.name, ...(point(v.latitude,v.longitude) ? { latitude: v.latitude as number, longitude: v.longitude as number } : {}) }
}
export function parseFavoritePreferences(value: unknown): FavoritePreferences {
  const v = obj(value), p: FavoritePreferences = {}
  if (v.mode !== undefined) { if (!['departure','arrival'].includes(String(v.mode))) throw new Error('Mode invalide.'); p.mode = v.mode as FavoritePreferences['mode'] }
  for (const key of ['departureTime','arrivalTime'] as const) if (v[key] !== undefined) { if (typeof v[key] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v[key])) throw new Error('Heure habituelle invalide.'); p[key] = v[key] }
  if (v.marginSeconds !== undefined) { if (typeof v.marginSeconds !== 'number' || !Number.isInteger(v.marginSeconds) || v.marginSeconds < 30 || v.marginSeconds > 1800) throw new Error('Marge invalide (30 à 1800 s).'); p.marginSeconds = v.marginSeconds }
  if (v.maxTransfers !== undefined) { if (v.maxTransfers !== 1 && v.maxTransfers !== 2) throw new Error('Nombre de correspondances invalide.'); p.maxTransfers = v.maxTransfers }
  if (v.walkingTransfers !== undefined) { if (typeof v.walkingTransfers !== 'boolean') throw new Error('Préférence de marche invalide.'); p.walkingTransfers = v.walkingTransfers }
  if (v.order !== undefined) { if (!['arrival','departure','duration','transfers','walking','waiting'].includes(String(v.order))) throw new Error('Classement invalide.'); p.order = v.order as FavoritePreferences['order'] }
  return p
}
export const resolveEndpoint = (s: FavoriteStore, e: FavoriteEndpoint): SavedLocation | undefined => 'placeId' in e ? s.places.find(p => p.id === e.placeId)?.location : e.location
export const locationKey = (p: SavedLocation) => p.kind === 'unresolved' ? `unresolved:${p.name}` : `${p.kind}:${p.id}`
export function favoriteEndpoint(s: FavoriteStore, location: SavedLocation): FavoriteEndpoint {
  const p = s.places.find(p => locationKey(p.location) === locationKey(location) && (location.kind !== 'address' || p.location.kind === 'address' && p.location.latitude === location.latitude && p.location.longitude === location.longitude))
  return p ? { placeId: p.id } : { location }
}
export const savedLocation = (p: JourneyPlace): SavedLocation => parseLocation(isAddress(p) ? p : { kind: 'stop', id: p.id, name: p.name, ...(p.latitude !== null && p.longitude !== null ? { latitude: p.latitude, longitude: p.longitude } : {}) })
function endpoint(value: unknown, places: FavoritePlace[]): FavoriteEndpoint {
  const v = obj(value)
  if ('placeId' in v) { if (!str(v.placeId) || !places.some(p => p.id === v.placeId)) throw new Error('Lieu référencé introuvable.'); return { placeId: v.placeId } }
  return { location: parseLocation(v.location) }
}
export function parseFavoriteStore(value: unknown): FavoriteStore {
  const v = obj(value)
  if (v.version !== 2 || !Number.isSafeInteger(v.revision) || Number(v.revision) < 0 || !Array.isArray(v.places) || !Array.isArray(v.trips) || v.places.length > 200 || v.trips.length > 200) throw new Error('Format de favoris inconnu ou trop volumineux.')
  const places: FavoritePlace[] = v.places.map(raw => { const p = obj(raw); if (!str(p.id) || !str(p.name,100) || !['home','work','other'].includes(String(p.role)) || !date(p.createdAt) || !date(p.updatedAt)) throw new Error('Lieu favori invalide.'); return { id: p.id, name: p.name, role: p.role as FavoritePlace['role'], location: parseLocation(p.location), createdAt: p.createdAt, updatedAt: p.updatedAt } })
  const trips: FavoriteTrip[] = v.trips.map(raw => { const t = obj(raw); if (!str(t.id) || !str(t.name,100) || !date(t.createdAt) || !date(t.updatedAt)) throw new Error('Trajet favori invalide.'); return { id: t.id, name: t.name, from: endpoint(t.from,places), to: endpoint(t.to,places), preferences: parseFavoritePreferences(t.preferences), createdAt: t.createdAt, updatedAt: t.updatedAt } })
  if (new Set([...places,...trips].map(p => p.id)).size !== places.length + trips.length || ['home','work'].some(r => places.filter(p => p.role === r).length > 1)) throw new Error('Identifiants ou lieux principaux dupliqués.')
  return { version: 2, revision: Number(v.revision), places, trips, preferences: parseFavoritePreferences(v.preferences) }
}
function migrate(items: unknown[]): FavoriteStore {
  const now = new Date().toISOString(), s = emptyFavoriteStore()
  s.trips = items.map(raw => {
    const v = obj(raw)
    if (!str(v.id) || !str(v.departure) || !str(v.arrival) || [v.departureStopId,v.arrivalStopId].some(id => id !== undefined && !str(id))) throw new Error('Ancien favori invalide.')
    const loc = (name: string, id: unknown): SavedLocation => typeof id === 'string' ? { kind: 'stop', id, name } : { kind: 'unresolved', name }
    return { id: v.id, name: `${v.departure} → ${v.arrival}`.slice(0,100), from: { location: loc(v.departure,v.departureStopId) }, to: { location: loc(v.arrival,v.arrivalStopId) }, preferences: {}, createdAt: now, updatedAt: now }
  })
  return parseFavoriteStore(s)
}
export function readFavoriteStore(): { data: FavoriteStore; error: string; migrated: boolean } {
  try {
    const raw = localStorage.getItem(favoritesKey)
    if (!raw) return { data: emptyFavoriteStore(), error: '', migrated: false }
    if (raw.length > 2000000) throw new Error('Too large')
    const v: unknown = JSON.parse(raw)
    return { data: Array.isArray(v) ? migrate(v) : parseFavoriteStore(v), error: '', migrated: Array.isArray(v) }
  } catch { return { data: emptyFavoriteStore(), error: 'Les favoris sont illisibles ou le stockage local est indisponible. Ils restent conservés ; aucun écrasement automatique.', migrated: false } }
}
export function writeFavoriteStore(value: FavoriteStore): { data?: FavoriteStore; error: string } {
  try {
    const current = readFavoriteStore()
    if (current.error) return { error: current.error }
    if (current.data.revision !== value.revision) return { error: 'Les favoris ont changé dans un autre onglet. Rechargez avant de modifier.' }
    const data = parseFavoriteStore({ ...value, revision: value.revision + 1 }), raw = JSON.stringify(data)
    if (raw.length > 2000000) throw new Error('Too large')
    localStorage.setItem(favoritesKey,raw); return { data, error: '' }
  } catch { return { error: 'Impossible de modifier les favoris : stockage indisponible, saturé ou données invalides.' } }
}
export function clearFavoriteStore(): string { try { localStorage.removeItem(favoritesKey); return '' } catch { return 'Impossible d’effacer les favoris : stockage indisponible.' } }
export function savePlace(s: FavoriteStore, input: Pick<FavoritePlace,'name'|'role'|'location'>, id?: string): FavoriteStore {
  const location = parseLocation(input.location)
  if (location.kind === 'unresolved') throw new Error('Sélectionnez un lieu validé.')
  if (s.places.some(p => p.id !== id && (locationKey(p.location) === locationKey(location) || input.role !== 'other' && p.role === input.role))) throw new Error('Ce lieu ou ce rôle principal existe déjà. Modifiez le lieu enregistré.')
  const now = new Date().toISOString(), old = s.places.find(p => p.id === id)
  return parseFavoriteStore({ ...s, places: [...s.places.filter(p => p.id !== id),{ ...input, name: input.name.trim(), location, id: old?.id || crypto.randomUUID(), createdAt: old?.createdAt || now, updatedAt: now }] })
}
export function saveTrip(s: FavoriteStore, input: Pick<FavoriteTrip,'name'|'from'|'to'|'preferences'>, id?: string): FavoriteStore {
  const a = resolveEndpoint(s,input.from), b = resolveEndpoint(s,input.to)
  if (!a || !b || a.kind === 'unresolved' || b.kind === 'unresolved' || locationKey(a) === locationKey(b)) throw new Error('Sélectionnez deux lieux validés distincts.')
  const preferences = parseFavoritePreferences(input.preferences)
  const signature = (x: SavedLocation, y: SavedLocation, p: FavoritePreferences) => {
    const effective = { ...s.preferences, ...p }, mode = effective.mode || 'departure'
    return JSON.stringify([locationKey(x),locationKey(y),parseFavoritePreferences({ mode, maxTransfers:2, walkingTransfers:false, order:mode === 'arrival' ? 'departure' : 'arrival', ...effective, marginSeconds: undefined })])
  }
  if (s.trips.some(t => t.id !== id && signature(resolveEndpoint(s,t.from)!,resolveEndpoint(s,t.to)!,t.preferences) === signature(a,b,preferences))) throw new Error('Ce trajet avec ces préférences existe déjà dans les favoris.')
  const now = new Date().toISOString(), old = s.trips.find(p => p.id === id)
  return parseFavoriteStore({ ...s, trips: [...s.trips.filter(p => p.id !== id),{ ...input, name: input.name.trim(), preferences, id: old?.id || crypto.randomUUID(), createdAt: old?.createdAt || now, updatedAt: now }] })
}
export function removePlace(s: FavoriteStore, id: string): FavoriteStore {
  const p = s.places.find(p => p.id === id); if (!p) return s
  const detach = (e: FavoriteEndpoint): FavoriteEndpoint => 'placeId' in e && e.placeId === id ? { location: p.location } : e
  return { ...s, places: s.places.filter(p => p.id !== id), trips: s.trips.map(t => ({ ...t, from: detach(t.from), to: detach(t.to) })) }
}
export function favoriteDraft(a: SavedLocation, b: SavedLocation): JourneyDraft {
  const fields = (p: SavedLocation, side: 'departure'|'arrival') => p.kind === 'address' ? { [side]: p.name, [side+'Address']: p } : { [side]: p.name, ...(p.kind === 'stop' ? { [side+'StopId']: p.id } : {}) }
  return { departure: a.name, arrival: b.name, ...fields(a,'departure'), ...fields(b,'arrival') }
}
// Compatibility adapter: still the same store, never a second favorites system.
export function readFavorites(): { items: Favorite[]; error: string } {
  const {data,error} = readFavoriteStore()
  return { items: data.trips.map(t => { const a = resolveEndpoint(data,t.from)!, b = resolveEndpoint(data,t.to)!; return { id: t.id, departure: a.name, arrival: b.name, ...(a.kind === 'stop' ? { departureStopId: a.id } : {}), ...(b.kind === 'stop' ? { arrivalStopId: b.id } : {}) } }), error }
}
export function writeFavorites(items: Favorite[]): string { try { const current = readFavoriteStore(); if (current.error) return current.error; return writeFavoriteStore({ ...current.data, trips: migrate(items).trips }).error } catch { return 'Favoris invalides ou stockage indisponible.' } }
