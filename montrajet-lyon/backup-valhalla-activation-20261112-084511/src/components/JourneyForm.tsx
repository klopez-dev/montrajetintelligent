import type { JourneyFormSettings } from '../services/favoriteJourney'
import { favoriteSchedule } from '../services/favoriteJourney'
import type { FavoriteLaunch, FavoritePlace, FavoritePreferences } from '../types/favorites'
import { JourneyTraffic } from './JourneyTraffic'
import { JourneyProgress } from './JourneyProgress'
import type { SearchProgress } from '../types/searchProgress'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDownUp, ArrowRight, Heart, Navigation, Search } from 'lucide-react'
import { journeysApi } from '../services/journeys'
import type { JourneyDraft, JourneyOrder, RoutingResult } from '../types/journey'
import { GtfsSearchField } from './GtfsSearchField'
import { JourneyResults } from './JourneyResults'
import { localDateCandidates } from '../services/localDateTime'
import { mobilityApi } from '../services/mobility'
import { isAddress } from '../types/mobility'
import type { JourneyPlace, MobilityQuery, MobilityResult } from '../types/mobility'
import { MobilityResults } from './MobilityResults'

const describe = (stop: JourneyPlace) => isAddress(stop) ? `Adresse · ${stop.source} · ${stop.precision === 'housenumber' ? 'numéro identifié' : 'rue sans numéro : précisez le domicile'}` : `Quai ${stop.id}${stop.platform ? ` · ${stop.platform}` : ''} · Lignes ${stop.lines.map(line => line.name).join(', ') || 'non renseignées'}${stop.parentId ? ` · Station ${stop.parentId}` : ''}`
export function JourneyForm({ route, onRouteChange, onSave, active = true, places = [], launch, onOpenFavorites, settings, onSettingsChange }: { route: JourneyDraft; onRouteChange: (route: JourneyDraft) => void; onSave: (departure: JourneyPlace, arrival: JourneyPlace, preferences: FavoritePreferences, name?: string) => string; active?: boolean; places?: FavoritePlace[]; launch?: FavoriteLaunch|null; onOpenFavorites?: () => void; settings: JourneyFormSettings; onSettingsChange: (update: (s: JourneyFormSettings) => JourneyFormSettings) => void }) {
  const [departure, setDeparture] = useState<JourneyPlace | null>(null)
  const [arrival, setArrival] = useState<JourneyPlace | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RoutingResult | null>(null)
  const [doorResult, setDoorResult] = useState<MobilityResult | null>(null)
  const { mode,dateTime,fold,order,margin,maxTransfers,walkingTransfers } = settings
  const setMode = useCallback((value: JourneyFormSettings['mode']) => onSettingsChange(current => ({ ...current, mode: value })), [onSettingsChange])
  const setDateTime = useCallback((value: JourneyFormSettings['dateTime']) => onSettingsChange(current => ({ ...current, dateTime: value })), [onSettingsChange])
  const setFold = useCallback((value: JourneyFormSettings['fold']) => onSettingsChange(current => ({ ...current, fold: value })), [onSettingsChange])
  const setOrder = useCallback((value: JourneyFormSettings['order']) => onSettingsChange(current => ({ ...current, order: value })), [onSettingsChange])
  const setMargin = useCallback((value: JourneyFormSettings['margin']) => onSettingsChange(current => ({ ...current, margin: value })), [onSettingsChange])
  const setMaxTransfers = useCallback((value: JourneyFormSettings['maxTransfers']) => onSettingsChange(current => ({ ...current, maxTransfers: value })), [onSettingsChange])
  const setWalkingTransfers = useCallback((value: JourneyFormSettings['walkingTransfers']) => onSettingsChange(current => ({ ...current, walkingTransfers: value })), [onSettingsChange])
  const pending = useRef<AbortController | null>(null)
  const [events, setEvents] = useState<SearchProgress[]>([])
  const [started, setStarted] = useState(0)
  const [retained, setRetained] = useState(false)
  const [resultSummary, setResultSummary] = useState('')
  const form = useRef<HTMLFormElement>(null)
  const consumedLaunch = useRef('')
  const appliedLaunch = useRef<{ id: string; mode: 'departure'|'arrival'; dateTime: string; margin: string; order: MobilityQuery['order']; maxTransfers: '1'|'2'; walkingTransfers: boolean }|null>(null)
  const [verifiedKey, setVerifiedKey] = useState(''), [referenceError, setReferenceError] = useState('')
  const [favoriteName, setFavoriteName] = useState(''), [saveTime, setSaveTime] = useState(false)
  const [resultFavorite, setResultFavorite] = useState<{ departure: JourneyPlace; arrival: JourneyPlace; preferences: FavoritePreferences }|null>(null)
  const validationKey = JSON.stringify([route.departureStopId,route.arrivalStopId,launch?.id,active])
  const selectedDeparture = route.departureAddress || (departure?.id === route.departureStopId ? departure : null)
  const selectedArrival = route.arrivalAddress || (arrival?.id === route.arrivalStopId ? arrival : null)
  const useWalking = walkingTransfers || Boolean(route.departureAddress || route.arrivalAddress)
  const dateCandidates = localDateCandidates(dateTime)
  const selectedInstant = dateCandidates[Number(fold)] ?? dateCandidates[0]

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    const checks = ([['departure',route.departureStopId],['arrival',route.arrivalStopId]] as const).map(async ([side,id]) => {
      if (!id) return ''
      try {
        const response = await journeysApi.stopById(id,controller.signal)
        if (controller.signal.aborted) return ''
        const stop = response.status === 'connected' && response.data[0]?.id === id ? response.data[0] : null
        if (side === 'departure') setDeparture(stop); else setArrival(stop)
        return stop ? '' : `Quai ${id} introuvable ou base GTFS indisponible. Le favori est conservé ; sélectionnez à nouveau le quai.`
      } catch { return controller.signal.aborted ? '' : `Quai ${id} non vérifiable : calcul non lancé. Réessayez ou modifiez le favori.` }
    })
    void Promise.all(checks).then(messages => { if (!controller.signal.aborted) { setVerifiedKey(validationKey); setReferenceError(messages.filter(Boolean).join(' ')) } })
    return () => controller.abort()
  }, [route.departureStopId,route.arrivalStopId,launch?.id,active,validationKey])
  useEffect(() => () => pending.current?.abort(), [])
  const clear = useCallback((cancelLaunch = true) => {
    if (cancelLaunch && launch) consumedLaunch.current = launch.id
    pending.current?.abort(); pending.current = null
    setBusy(false); setEvents([]); setRetained(true); setMessage(''); setError('')
  }, [launch])
  function cancel() { clear(); setMessage('Recherche annulée. Les résultats précédents restent consultables.') }

  useEffect(() => {
    if (!active) { if (launch) consumedLaunch.current = launch.id; pending.current?.abort() }
  }, [active,launch])
  useEffect(() => {
    if (!launch || appliedLaunch.current?.id === launch.id) return
    clear(false)
    const schedule = favoriteSchedule(dateTime,{ mode, marginSeconds:Number(margin), maxTransfers:Number(maxTransfers) as 1|2, order, walkingTransfers },launch.preferences)
    const p = schedule.preferences
    const preferredOrder = launch.preferences.order || (p.mode && p.mode !== mode ? p.mode === 'arrival' ? 'departure' : 'arrival' : order)
    const target = { id: launch.id, mode:p.mode || mode, dateTime:schedule.dateTime, margin:String(p.marginSeconds ?? margin), maxTransfers:String(p.maxTransfers ?? maxTransfers) as '1'|'2', order:preferredOrder, walkingTransfers:p.walkingTransfers ?? walkingTransfers }
    appliedLaunch.current = target
    setMode(target.mode);setDateTime(target.dateTime);setMargin(target.margin);setMaxTransfers(target.maxTransfers);setOrder(target.order);setWalkingTransfers(target.walkingTransfers);if(target.dateTime!==dateTime)setFold('0')
  }, [launch,mode,dateTime,margin,maxTransfers,order,walkingTransfers,clear,setMode,setDateTime,setMargin,setMaxTransfers,setOrder,setWalkingTransfers,setFold])
  useEffect(() => {
    const target = appliedLaunch.current
    if (!active || !launch?.run || consumedLaunch.current === launch.id || !target || target.id !== launch.id || verifiedKey !== validationKey) return
    if (referenceError) { consumedLaunch.current = launch.id; return }
    if (!selectedDeparture || !selectedArrival || target.mode!==mode || target.dateTime!==dateTime || target.margin!==margin || target.maxTransfers!==maxTransfers || target.order!==order || target.walkingTransfers!==walkingTransfers) return
    consumedLaunch.current = launch.id
    form.current?.requestSubmit()
  }, [active,launch,verifiedKey,validationKey,referenceError,selectedDeparture,selectedArrival,mode,dateTime,margin,maxTransfers,order,walkingTransfers])
  function chooseFavorite(id: string, side: 'departure'|'arrival') {
    const value = places.find(p => p.id === id)?.location
    if (!value || value.kind === 'unresolved') return
    clear()
    if (side === 'departure') setDeparture(null); else setArrival(null)
    onRouteChange({ ...route, [side]:value.name, [side+'StopId']:value.kind === 'stop' ? value.id : undefined, [side+'Address']:value.kind === 'address' ? value : undefined })
  }
  const favoritePreferences = (): FavoritePreferences => ({ mode, marginSeconds:Number(margin), maxTransfers:Number(maxTransfers) as 1|2, order, walkingTransfers, ...(saveTime ? mode === 'departure' ? { departureTime:dateTime.slice(11,16) } : { arrivalTime:dateTime.slice(11,16) } : {}) })
  function valid() {
    const issue = !selectedDeparture || !selectedArrival ? 'Sélectionnez explicitement le départ et l’arrivée parmi les arrêts GTFS ou les adresses proposés.' : selectedDeparture.id === selectedArrival.id ? 'Choisissez deux lieux différents.' : ''
    setError(issue); setMessage(''); return !issue
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current) return
    if (!valid() || !selectedDeparture || !selectedArrival) return
    if (!dateCandidates.length) { setError('Choisissez une date et une heure locales valides. Cette heure peut ne pas exister lors du changement d’heure.'); return }
    if (!/^\d+$/.test(margin) || Number(margin) < 30 || Number(margin) > 1800) { setError('Choisissez une marge entre 30 et 1800 secondes.'); return }
    const controller = new AbortController()
    pending.current = controller
    setBusy(true); setEvents([]); setStarted(Date.now()); setRetained(true); setError(''); setMessage('')
    const summary = `${selectedDeparture.name} → ${selectedArrival.name} · ${mode === 'arrival' ? 'Arriver avant' : 'Partir à'} ${new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(selectedInstant))}`
    const progress = (event: SearchProgress) => {
      if (pending.current === controller && !controller.signal.aborted) setEvents(previous => previous.at(-1)?.stage === event.stage ? previous : [...previous, event])
    }
    try {
      const checks = await Promise.all([selectedDeparture,selectedArrival].map(async place => {
        if (isAddress(place)) return ''
        const response = await journeysApi.stopById(place.id,controller.signal)
        return response.status === 'connected' && response.data[0]?.id === place.id ? '' : `Quai ${place.id} introuvable ou non vérifiable. Le favori reste conservé : sélectionnez à nouveau le quai.`
      }))
      if (controller.signal.aborted || pending.current !== controller) return
      if (checks.some(Boolean)) { setError(checks.filter(Boolean).join(' ')); return }
      if (useWalking) {
        const ref = (place: JourneyPlace) => isAddress(place) ? { kind: 'address' as const, id: place.id, name: place.name, expectedCoordinates: { latitude: place.latitude, longitude: place.longitude } } : { kind: 'stop' as const, id: place.id }
        const response = await mobilityApi.search({ from: ref(selectedDeparture), to: ref(selectedArrival), at: new Date(selectedInstant).toISOString(), mode, marginSeconds: Number(margin), order, walkingTransfers, maxTransfers: Number(maxTransfers) as 1 | 2 }, controller.signal, progress)
        if (controller.signal.aborted || pending.current !== controller) return
        if (response.status === 'connected' && !response.data.itineraries.length && response.data.providerIssues?.length) setError(`Recherche non confirmée : ${response.data.providerIssues[0].message}`)
        else if (response.status === 'connected') { setDoorResult(response.data); setResult(null); setRetained(false); setResultSummary(summary); setResultFavorite({ departure:selectedDeparture, arrival:selectedArrival, preferences:favoritePreferences() }) }
        else setError(response.message)
        return
      }
      const response = await journeysApi.search({ fromStopId: selectedDeparture.id, toStopId: selectedArrival.id, at: new Date(selectedInstant).toISOString(), mode, marginSeconds: Number(margin), order: ['walking', 'waiting'].includes(order) ? 'arrival' : order as JourneyOrder, maxTransfers: Number(maxTransfers) as 1 | 2 }, controller.signal, progress)
      if (controller.signal.aborted || pending.current !== controller) return
      if (response.status === 'connected') { setResult(response.data); setDoorResult(null); setRetained(false); setResultSummary(summary); setResultFavorite({ departure:selectedDeparture, arrival:selectedArrival, preferences:favoritePreferences() }) }
      else setError(response.message)
    } catch { if (!controller.signal.aborted) setError('La recherche est indisponible. Veuillez réessayer.') }
    finally { if (pending.current === controller) { pending.current = null; setBusy(false); setEvents([]) } }
  }
  return <section className="panel journey-panel">
    <div className="panel-heading"><div><span className="section-kicker">VOTRE PROCHAIN DÉPLACEMENT</span><h2>Où souhaitez-vous aller ?</h2></div><span className="heading-icon"><Navigation size={22}/></span></div>
    <p className="search-hint">Calcul GTFS théorique · Jusqu’à deux correspondances · Arrêts TCL et adresses françaises. Accès piétons retenus selon les parcours et durées estimés par IGN, dans les budgets indiqués.</p>
    <div className="favorite-form-choices"><label className="field"><span>Départ depuis mes lieux favoris</span><select className="favorite-departure" value="" onChange={e => chooseFavorite(e.target.value,'departure')}><option value="">Choisir un lieu favori</option>{places.map(p => <option key={p.id} value={p.id}>{p.name} · {p.location.name}</option>)}</select></label><label className="field"><span>Destination depuis mes lieux favoris</span><select className="favorite-arrival" value="" onChange={e => chooseFavorite(e.target.value,'arrival')}><option value="">Choisir un lieu favori</option>{places.map(p => <option key={p.id} value={p.id}>{p.name} · {p.location.name}</option>)}</select></label>{onOpenFavorites && <button className="text-button" type="button" onClick={onOpenFavorites}>Gérer mes lieux et trajets favoris</button>}</div>
    <form ref={form} onSubmit={search} noValidate>
      <div className="journey-stop-fields">
        <GtfsSearchField disabled={!active} manualSearch={Boolean(route.departureStopId && !selectedDeparture)} debounceMs={350} label="Départ" placeholder="Arrêt TCL ou adresse avec numéro" selected={selectedDeparture} queryText={route.departure} search={mobilityApi.searchPlaces} describe={describe} onQueryChange={value => { clear(); onRouteChange({ ...route, departure: value, departureStopId: undefined, departureAddress: undefined }) }} onSelect={value => { setDeparture(value); if (value) { clear(); onRouteChange({ ...route, departure: value.name, departureStopId: isAddress(value) ? undefined : value.id, departureAddress: isAddress(value) ? value : undefined }) } }}/>
        <button className="icon-button journey-swap" type="button" aria-label="Inverser le départ et la destination" onClick={() => { clear(); setDeparture(selectedArrival); setArrival(selectedDeparture); onRouteChange({ departure: route.arrival, arrival: route.departure, departureStopId: route.arrivalStopId, arrivalStopId: route.departureStopId, departureAddress: route.arrivalAddress, arrivalAddress: route.departureAddress }) }}><ArrowDownUp size={18}/></button>
        <GtfsSearchField disabled={!active} manualSearch={Boolean(route.arrivalStopId && !selectedArrival)} debounceMs={350} label="Destination" placeholder="Arrêt TCL ou adresse avec numéro" selected={selectedArrival} queryText={route.arrival} search={mobilityApi.searchPlaces} describe={describe} onQueryChange={value => { clear(); onRouteChange({ ...route, arrival: value, arrivalStopId: undefined, arrivalAddress: undefined }) }} onSelect={value => { setArrival(value); if (value) { clear(); onRouteChange({ ...route, arrival: value.name, arrivalStopId: isAddress(value) ? undefined : value.id, arrivalAddress: isAddress(value) ? value : undefined }) } }}/>
      </div>
      <div className="time-fields">
        <label className="field"><span>Votre préférence</span><select value={mode} onChange={event => { clear(); setMode(event.target.value as typeof mode); setOrder(event.target.value === 'arrival' ? 'departure' : 'arrival') }}><option value="departure">Partir à</option><option value="arrival">Arriver avant</option></select></label>
        <label className="field"><span>Date et heure (cet appareil)</span><input type="datetime-local" required value={dateTime} onChange={event => { clear(); setDateTime(event.target.value); setFold('0') }}/></label>
      </div>
      {dateCandidates.length > 1 && <label className="field"><span>Cette heure existe deux fois : choisissez son occurrence</span><select value={fold} onChange={event => { clear(); setFold(event.target.value) }}>{dateCandidates.map((instant, index) => <option key={instant} value={String(index)}>{index === 0 ? 'Première' : 'Seconde'} occurrence · {new Intl.DateTimeFormat('fr-FR', { hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset' }).format(new Date(instant))}</option>)}</select></label>}
      {dateCandidates.length > 0 && <p className="search-hint">Instant retenu : {new Intl.DateTimeFormat('fr-FR', { day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'shortOffset' }).format(new Date(selectedInstant))}.</p>}
      <div className="time-fields">
        <label className="field"><span>Marge ajoutée (secondes, 30 minimum)</span><input type="number" min="30" max="1800" step="1" required value={margin} onChange={event => { clear(); setMargin(event.target.value) }}/></label>
        <label className="field"><span>Classer les propositions</span><select value={order} onChange={event => { clear(); setOrder(event.target.value as MobilityQuery['order']) }}><option value="arrival">Arrivée la plus tôt</option><option value="departure">Départ le plus tardif</option><option value="duration">Durée la plus courte</option><option value="transfers">Moins de correspondances</option>{useWalking && <><option value="walking">Moins de marche connue</option><option value="waiting">Moins d’attente connue</option></>}</select></label>
      </div>
      <label className="field"><span>Correspondances maximum</span><select aria-label="Correspondances maximum" value={maxTransfers} onChange={event => { clear(); setMaxTransfers(event.target.value as '1' | '2') }}><option value="1">Une correspondance</option><option value="2">Deux correspondances</option></select></label>
      <label className="walking-option"><input type="checkbox" checked={walkingTransfers} onChange={event => { clear(); setWalkingTransfers(event.target.checked) }}/> Examiner aussi des correspondances à pied entre arrêts de surface (IGN, périmètre limité)</label>
      <p className="search-hint">Les suggestions d’adresses saisies ici sont transmises au service officiel IGN. Un lieu favori sélectionné ne déclenche aucun géocodage avant le calcul.</p>
      <label className="field"><span>Nom du trajet favori (facultatif)</span><input className="favorite-trip-name" maxLength={100} value={favoriteName} onChange={e => setFavoriteName(e.target.value)}/></label>
      <label className="walking-option"><input type="checkbox" checked={saveTime} onChange={e => setSaveTime(e.target.checked)}/> Mémoriser aussi cette heure habituelle, sans enregistrer la date</label>
      <button className="primary search-button" disabled={busy}><Search size={19}/>{busy ? 'Calcul des itinéraires…' : 'Rechercher un itinéraire'}<ArrowRight size={18}/></button>
      {busy && <JourneyProgress events={events} started={started} onCancel={cancel}/>}
      <button className="save-button" type="button" onClick={() => { if (valid() && selectedDeparture && selectedArrival) setMessage(onSave(selectedDeparture,selectedArrival,favoritePreferences(),favoriteName)) }}><Heart size={17}/> Enregistrer ce trajet en favori</button>
      {referenceError && <p className="message error reference-error" role="alert">{referenceError}</p>}
      {error && <p className="message error" role="alert">{error}</p>}{message && <p className="message" role="status">{message}</p>}
      <p className="form-note">Horaires théoriques, sans temps réel. Marge configurable ajoutée aux minima GTFS.</p>
    </form>
    {(result || doorResult) && <p className={retained ? 'previous-result-note message' : 'result-summary'} role="status">{retained ? 'Résultats conservés de la recherche précédente : ' : ''}{resultSummary}</p>}
    {(result || doorResult) && <JourneyTraffic journeys={result ? result.itineraries : doorResult!.itineraries.map(i => i.transit)}/>}
    {resultFavorite && <button className="secondary save-result-favorite" type="button" onClick={() => setMessage(onSave(resultFavorite.departure,resultFavorite.arrival,resultFavorite.preferences,favoriteName))}>Enregistrer le trajet des résultats affichés</button>}
    {result && <JourneyResults result={result}/>}
    {doorResult && <MobilityResults result={doorResult}/>}
  </section>
}
