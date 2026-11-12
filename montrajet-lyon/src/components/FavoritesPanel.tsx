import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { FavoriteEndpoint, FavoritePlace, FavoritePreferences, FavoriteStore, FavoriteTrip, SavedLocation } from '../types/favorites'
import { removePlace, resolveEndpoint, savePlace, saveTrip } from '../services/favorites'
import { FavoriteConfirmation, FavoriteEndpointField, FavoriteLocationField, FavoritePreferenceFields } from './FavoriteFields'

interface Props {
  store: FavoriteStore
  notice: string
  onCommit: (s: FavoriteStore) => boolean
  onClear: () => boolean
  onUse: (from: SavedLocation, to: SavedLocation, preferences: FavoritePreferences, run: boolean) => void
  onUsePlace: (place: SavedLocation, side: 'departure'|'arrival') => void
}
function PlaceEditor({ initial, role, onSave, onCancel }: { initial?: FavoritePlace; role: FavoritePlace['role']; onSave: (input: Pick<FavoritePlace,'name'|'role'|'location'>) => boolean; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name || (role === 'home' ? 'Domicile' : role === 'work' ? 'Travail' : ''))
  const [type, setType] = useState(role), [location, setLocation] = useState<SavedLocation|null>(initial?.location || null), [error, setError] = useState('')
  return <form className="favorite-editor" onSubmit={e => { e.preventDefault(); if (!location || !name.trim()) { setError('Nommez ce lieu et sélectionnez explicitement une localisation.'); return }; if (onSave({ name, role: type, location })) onCancel() }} noValidate><h3>{initial ? 'Modifier ou remplacer le lieu' : 'Enregistrer un lieu'}</h3>
    <label className="field"><span>Nom personnalisé du lieu</span><input autoFocus required maxLength={100} value={name} onChange={e => setName(e.target.value)}/></label>
    <label className="field"><span>Rôle de ce lieu</span><select value={type} onChange={e => setType(e.target.value as typeof type)}><option value="home">Domicile principal</option><option value="work">Travail principal</option><option value="other">Autre lieu</option></select></label>
    <FavoriteLocationField label="Localisation du lieu" value={location} onChange={setLocation}/>
    {error && <p className="message error" role="alert">{error}</p>}
    <div className="favorite-actions"><button className="primary" type="submit">Enregistrer le lieu</button><button className="secondary" type="button" onClick={onCancel}>Annuler</button></div>
  </form>
}
function TripEditor({ store, initial, onSave, onCancel }: { store: FavoriteStore; initial?: FavoriteTrip; onSave: (input: Pick<FavoriteTrip,'name'|'from'|'to'|'preferences'>) => boolean; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name || ''), [from, setFrom] = useState<FavoriteEndpoint|null>(initial?.from || null), [to, setTo] = useState<FavoriteEndpoint|null>(initial?.to || null), [preferences, setPreferences] = useState(initial?.preferences || {}), [error, setError] = useState('')
  return <form className="favorite-editor" onSubmit={e => { e.preventDefault(); if (!name.trim() || !from || !to) { setError('Nommez le trajet et sélectionnez ses deux lieux.'); return }; if (onSave({ name, from, to, preferences })) onCancel() }} noValidate><h3>{initial ? 'Modifier ou renommer le trajet' : 'Créer un trajet fréquent'}</h3>
    <label className="field"><span>Nom personnalisé du trajet</span><input autoFocus required maxLength={100} value={name} onChange={e => setName(e.target.value)}/></label>
    <FavoriteEndpointField label="Départ du trajet" value={from} store={store} onChange={setFrom}/><FavoriteEndpointField label="Destination du trajet" value={to} store={store} onChange={setTo}/>
    <button className="secondary" type="button" onClick={() => { setFrom(to); setTo(from) }}>Inverser les lieux dans l’éditeur</button>
    <FavoritePreferenceFields value={preferences} onChange={setPreferences}/>
    {error && <p className="message error" role="alert">{error}</p>}<div className="favorite-actions"><button className="primary" type="submit">Enregistrer le trajet</button><button className="secondary" type="button" onClick={onCancel}>Annuler</button></div>
  </form>
}
export function FavoritesPanel({ store, notice, onCommit, onClear, onUse, onUsePlace }: Props) {
  const [editor, setEditor] = useState<{ kind: 'place'|'trip'; id?: string; role?: FavoritePlace['role'] }|null>(null), [confirmation, setConfirmation] = useState<{ text: string; action: () => void }|null>(null)
  const [error, setError] = useState(''), [preferences, setPreferences] = useState(store.preferences)
  const home = store.places.find(p => p.role === 'home'), work = store.places.find(p => p.role === 'work')
  function commit(action: () => FavoriteStore) { try { const data = action(); if (!onCommit(data)) return false; setError(''); return true } catch (e) { setError(e instanceof Error ? e.message : 'Modification impossible.'); return false } }
  function launch(t: FavoriteTrip, run: boolean) { const a = resolveEndpoint(store,t.from), b = resolveEndpoint(store,t.to); if (!a || !b) { setError('Lieu lié manquant. Modifiez le favori.'); return }; onUse(a,b,{ ...store.preferences, ...t.preferences },run) }
  function placeCard(p: FavoritePlace) { return <li key={p.id} className="favorite-place" data-place-role={p.role}><h4>{p.name}</h4><p>{p.location.name}</p><small>{p.location.kind === 'stop' ? `Quai exact ${p.location.id}` : p.location.kind === 'address' ? 'Adresse BAN enregistrée localement' : 'Localisation à sélectionner à nouveau'}</small><div className="favorite-actions"><button className="secondary" onClick={() => onUsePlace(p.location,'departure')}>Utiliser comme départ</button><button className="secondary" onClick={() => onUsePlace(p.location,'arrival')}>Utiliser comme destination</button><button className="text-button" onClick={() => setEditor({ kind:'place',id:p.id,role:p.role })}>Modifier / Renommer</button><button className="icon-button" aria-label={`Supprimer le lieu ${p.name}`} onClick={() => setConfirmation({ text: `Supprimer le lieu ${p.name} ? Les trajets qui le référencent conserveront une copie de sa localisation ; supprimez aussi ces trajets pour retirer ces copies.`, action: () => { commit(() => removePlace(store,p.id)); setConfirmation(null) } })}><Trash2 size={18}/></button></div></li> }
  return <section className="panel standalone favorites-panel"><span className="section-kicker">VOTRE QUOTIDIEN</span><h2>Mes favoris</h2>
    <p>Stockés uniquement dans ce profil navigateur, sans compte ni synchronisation. D’autres personnes utilisant ce profil peuvent les lire ; ce stockage n’est ni chiffré ni une sauvegarde garantie.</p>
    {notice && <p className="message" role="status">{notice}</p>}{error && <p className="message error" role="alert">{error}</p>}
    <section className="favorite-section"><h3>Mes lieux</h3><div className="commute-config">
      {!home && <div><p>Votre domicile n’est pas défini.</p><button className="secondary configure-home" onClick={() => setEditor({ kind:'place',role:'home' })}>Définir mon domicile</button></div>}
      {!work && <div><p>Votre travail n’est pas défini.</p><button className="secondary configure-work" onClick={() => setEditor({ kind:'place',role:'work' })}>Définir mon travail</button></div>}
    </div><ul className="favorite-places">{store.places.filter(p => p.role !== 'other' || p.location.kind !== 'stop').map(placeCard)}</ul><button className="secondary add-place" onClick={() => setEditor({ kind:'place',role:'other' })}>Ajouter un lieu favori</button></section>
    <section className="favorite-section"><h3>Mes trajets</h3><div className="favorite-actions commute-actions"><button className="primary commute-work" disabled={!home || !work} onClick={() => home && work && onUse(home.location,work.location,store.preferences,true)}>Aller au travail</button><button className="secondary commute-home" disabled={!home || !work} onClick={() => home && work && onUse(work.location,home.location,store.preferences,true)}>Rentrer chez moi</button></div><p className="search-hint">Nouveau calcul à chaque action, avec la date du formulaire Itinéraires et vos préférences. Le retour est calculé indépendamment de l’aller.</p>
      {!store.trips.length && <div className="empty"><p>Aucun trajet fréquent enregistré. Enregistrez-en un depuis le formulaire de recherche ou créez-le ici.</p></div>}
      <ul className="favorites">{store.trips.map(t => { const a = resolveEndpoint(store,t.from)!, b = resolveEndpoint(store,t.to)!; return <li key={t.id} data-trip-id={t.id}><div><strong>{t.name}</strong><span>{a.name} vers {b.name}</span>{a.kind === 'stop' && b.kind === 'stop' && <small>Quais {a.id} → {b.id}</small>}{(a.kind === 'unresolved' || b.kind === 'unresolved') && <small>Ancien favori à compléter : aucune sélection approximative.</small>}</div><div className="favorite-actions"><button className="secondary" onClick={() => launch(t,false)}>Utiliser</button><button className="secondary recalculate-favorite" onClick={() => launch(t,true)}>Recalculer</button><button className="text-button" onClick={() => setEditor({ kind:'trip',id:t.id })}>Modifier / Renommer</button><button className="text-button" onClick={() => commit(() => saveTrip(store,{ ...t, from:t.to, to:t.from },t.id))}>Inverser</button><button className="icon-button" aria-label={`Supprimer le trajet ${a.name} vers ${b.name}`} onClick={() => setConfirmation({ text:`Supprimer le trajet ${t.name} ?`, action:() => { commit(() => ({ ...store,trips:store.trips.filter(p=>p.id!==t.id) }));setConfirmation(null) } })}><Trash2 size={18}/></button></div></li> })}</ul>
      <button className="secondary add-trip" onClick={() => setEditor({ kind:'trip' })}>Créer un trajet fréquent</button>
    </section>
    <section className="favorite-section"><h3>Mes arrêts</h3><ul className="favorite-places">{store.places.filter(p => p.role === 'other' && p.location.kind === 'stop').map(placeCard)}</ul>{!store.places.some(p=>p.role==='other'&&p.location.kind==='stop') && <p>Aucun arrêt favori supplémentaire. Choisissez « Arrêt TCL, quai exact » dans Ajouter un lieu favori.</p>}</section>
    <details className="favorite-defaults"><summary>Mes préférences habituelles</summary><FavoritePreferenceFields value={preferences} onChange={setPreferences}/><button className="secondary" onClick={() => commit(() => ({ ...store, preferences }))}>Enregistrer mes préférences</button></details>
    {editor?.kind === 'place' && <PlaceEditor key={`place-${editor.id || editor.role}`} initial={store.places.find(p=>p.id===editor.id)} role={editor.role || 'other'} onSave={input=>commit(()=>savePlace(store,input,editor.id))} onCancel={()=>setEditor(null)}/>}
    {editor?.kind === 'trip' && <TripEditor key={`trip-${editor.id || 'new'}`} store={store} initial={store.trips.find(t=>t.id===editor.id)} onSave={input=>commit(()=>saveTrip(store,input,editor.id))} onCancel={()=>setEditor(null)}/>}
    <button className="danger-button clear-favorites" onClick={() => setConfirmation({ text:'Supprimer définitivement tous les lieux, trajets et préférences de cette application sur ce profil navigateur ? Les autres données du navigateur ne seront pas effacées.', action:()=>{if(onClear()){setPreferences({});setEditor(null)}setConfirmation(null)} })}>Supprimer tous mes favoris</button>
    {confirmation && <FavoriteConfirmation text={confirmation.text} onConfirm={confirmation.action} onCancel={()=>setConfirmation(null)}/>}
    <p className="search-hint">Aucune recherche IGN à l’ouverture de cet onglet. Une localisation est vérifiée quand vous la recherchez explicitement ou lancez un calcul. Les favoris ne garantissent pas un résultat instantané.</p>
  </section>
}
