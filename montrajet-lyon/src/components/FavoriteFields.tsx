import { useEffect, useRef, useState } from 'react'
import type { FavoriteEndpoint, FavoritePreferences, FavoriteStore, SavedLocation } from '../types/favorites'
import type { JourneyPlace } from '../types/mobility'
import { savedLocation, resolveEndpoint } from '../services/favorites'
import { journeysApi } from '../services/journeys'
import { mobilityApi } from '../services/mobility'
import { GtfsSearchField } from './GtfsSearchField'

export function FavoriteLocationField({ label, value, onChange }: { label: string; value: SavedLocation|null; onChange: (v: SavedLocation|null) => void }) {
  const [kind, setKind] = useState(value?.kind === 'stop' || value?.kind === 'unresolved' ? 'stop' : 'address')
  const [query, setQuery] = useState(value?.name || ''), [error, setError] = useState('')
  const selected: JourneyPlace|null = value?.kind === 'address' ? value : value?.kind === 'stop' ? { id: value.id, name: value.name, code: '', platform: '', parentId: '', latitude: value.latitude ?? null, longitude: value.longitude ?? null, lines: [] } : null
  return <div className="favorite-location-field"><label className="field"><span>Type de localisation — {label}</span><select value={kind} onChange={e => { setKind(e.target.value); setQuery(''); onChange(null); setError('') }}><option value="address">Adresse française avec numéro</option><option value="stop">Arrêt TCL, quai exact</option></select></label>
    <GtfsSearchField<JourneyPlace> manualSearch label={label} placeholder={kind === 'address' ? 'Adresse avec numéro' : 'Nom ou identifiant du quai'} selected={selected} queryText={query} onQueryChange={setQuery} search={kind === 'address' ? mobilityApi.searchAddresses : journeysApi.searchStops} describe={p => 'kind' in p ? `Adresse ${p.source} · ${p.precision === 'housenumber' ? 'numéro identifié' : 'rue sans numéro, à préciser'}` : `Quai ${p.id} · ${p.lines.map(l => l.name).join(', ') || 'identifiant enregistré, revérifié au calcul'}`} onSelect={p => { setError(''); try { onChange(p ? savedLocation(p) : null) } catch { onChange(null); setError('Choisissez une adresse avec numéro, identifiant et coordonnées valides.') } }}/>
    {error && <p className="message error" role="alert">{error}</p>}
    <p className="search-hint">La recherche est déclenchée uniquement par le bouton. Aucun géocodage à l’ouverture. Les adresses recherchées sont transmises à Photon (OpenStreetMap).</p>
  </div>
}
export function FavoriteEndpointField({ label, value, store, onChange }: { label: string; value: FavoriteEndpoint|null; store: FavoriteStore; onChange: (v: FavoriteEndpoint|null) => void }) {
  return <div className="favorite-endpoint" data-endpoint={label.startsWith('Départ') ? 'from' : 'to'}><label className="field"><span>{label} parmi mes lieux</span><select value={value && 'placeId' in value ? value.placeId : ''} onChange={e => onChange(e.target.value ? { placeId: e.target.value } : null)}><option value="">Sélectionner un autre lieu</option>{store.places.map(p => <option key={p.id} value={p.id}>{p.name} · {p.location.name}</option>)}</select></label>
    {(!value || !('placeId' in value)) && <FavoriteLocationField key={label} label={label} value={value ? resolveEndpoint(store,value) || null : null} onChange={location => onChange(location ? { location } : null)}/>}
  </div>
}
export function FavoritePreferenceFields({ value, onChange }: { value: FavoritePreferences; onChange: (v: FavoritePreferences) => void }) {
  return <fieldset className="favorite-preferences"><legend>Préférences de calcul</legend>
    <label className="field"><span>Préférence de recherche</span><select value={value.mode || ''} onChange={e => onChange({ ...value, mode: e.target.value ? e.target.value as 'departure'|'arrival' : undefined })}><option value="">Conserver le choix du formulaire</option><option value="departure">Partir à</option><option value="arrival">Arriver avant</option></select></label>
    <div className="time-fields"><label className="field"><span>Heure habituelle de départ (cet appareil)</span><input type="time" value={value.departureTime || ''} onChange={e => onChange({ ...value, departureTime: e.target.value || undefined })}/></label><label className="field"><span>Heure habituelle d’arrivée (cet appareil)</span><input type="time" value={value.arrivalTime || ''} onChange={e => onChange({ ...value, arrivalTime: e.target.value || undefined })}/></label></div>
    <div className="time-fields"><label className="field"><span>Correspondances maximum</span><select value={value.maxTransfers ?? ''} onChange={e => onChange({ ...value, maxTransfers: e.target.value ? Number(e.target.value) as 1|2 : undefined })}><option value="">Conserver le formulaire</option><option value="1">Une correspondance</option><option value="2">Deux correspondances</option></select></label></div>
    <label className="field"><span>Correspondances à pied IGN</span><select value={value.walkingTransfers === undefined ? '' : String(value.walkingTransfers)} onChange={e => onChange({ ...value, walkingTransfers: e.target.value ? e.target.value === 'true' : undefined })}><option value="">Conserver le formulaire</option><option value="true">Examiner les correspondances à pied</option><option value="false">Sans liens piétons supplémentaires</option></select></label>
    <label className="field"><span>Classement</span><select value={value.order || ''} onChange={e => onChange({ ...value, order: e.target.value ? e.target.value as FavoritePreferences['order'] : undefined })}><option value="">Conserver le formulaire</option><option value="arrival">Arrivée la plus tôt</option><option value="departure">Départ le plus tardif</option><option value="duration">Durée</option><option value="transfers">Correspondances</option><option value="walking">Marche connue</option><option value="waiting">Attente connue</option></select></label>
    <p className="search-hint">La date choisie dans Itinéraires est conservée. Une heure habituelle remplace seulement l’heure, selon le mode retenu. Les résultats sont recalculés.</p>
  </fieldset>
}
export function FavoriteConfirmation({ text, onConfirm, onCancel }: { text: string; onConfirm: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close() }, [])
  return <dialog ref={dialog} className="favorite-confirmation" aria-labelledby="favorite-confirm-title" onCancel={e => { e.preventDefault(); onCancel() }}><h2 id="favorite-confirm-title">Confirmer la suppression</h2><p>{text}</p><div className="favorite-actions"><button autoFocus className="secondary" type="button" onClick={onCancel}>Annuler</button><button className="danger-button" type="button" onClick={onConfirm}>Confirmer la suppression</button></div></dialog>
}
