import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Search } from 'lucide-react'
import { gtfsApi } from '../services/gtfs'
import type { FeedMetadata, GtfsLine, GtfsStop, PassageResult } from '../types/gtfs'
import { Disconnected } from './Disconnected'
import { GtfsSearchField } from './GtfsSearchField'
import { nextExpiration, visiblePassages } from '../services/passageVisibility'
import { RealtimePassages } from './RealtimePassages'
import { withoutCoveredTrips } from '../services/realtime'

const dateLabel = (date: string) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date(`${date}T12:00:00Z`))
const departureLabel = (instant: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(instant))
const describeLine = (line: GtfsLine) => `${line.longName || line.name} · Identifiant ${line.id}`
const describeStop = (stop: GtfsStop) => [stop.code && `Code ${stop.code}`, stop.platform && `Quai ${stop.platform}`, `Identifiant ${stop.id}`, stop.parentId && `Station ${stop.parentId}`].filter(Boolean).join(' · ')

export function Timetable() {
  const [metadata, setMetadata] = useState<FeedMetadata | null>(null)
  const [statusMessage, setStatusMessage] = useState('Connexion au catalogue GTFS…')
  const [statusLoading, setStatusLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [line, setLine] = useState<GtfsLine | null>(null)
  const [stop, setStop] = useState<GtfsStop | null>(null)
  const [at, setAt] = useState('')
  const [result, setResult] = useState<PassageResult | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [currentTime, setCurrentTime] = useState(() => Date.now())
  const [liveTripIds, setLiveTripIds] = useState<string[]>([])
  const updateLiveTrips = useCallback((ids: string[]) => setLiveTripIds(ids), [])
  const pending = useRef<AbortController | null>(null)
  const searchStops = useCallback((query: string, signal: AbortSignal) => gtfsApi.searchStops(query, line?.id || '', signal), [line?.id])

  useEffect(() => {
    const controller = new AbortController()
    gtfsApi.status(controller.signal).then(response => {
      if (controller.signal.aborted) return
      if (response.status === 'connected') { setMetadata(response.data); setStatusMessage('') }
      else { setMetadata(null); setStatusMessage(response.message) }
      setStatusLoading(false)
    }).catch(() => { /* Une requête annulée n'affiche pas d'erreur. */ })
    return () => controller.abort()
  }, [retry])
  useEffect(() => () => pending.current?.abort(), [])

  useEffect(() => {
    if (!result || at) return
    const update = () => setCurrentTime(Date.now())
    const expiration = nextExpiration(result.passages, currentTime)
    const timer = expiration === null ? null : window.setTimeout(update, Math.max(0, expiration - Date.now()))
    // Les minuteurs peuvent être suspendus dans un onglet en arrière-plan.
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
    }
  }, [result, at, currentTime])
  const visibleGtfsPassages = result ? visiblePassages(result.passages, Boolean(at), currentTime) : []
  const displayedPassages = withoutCoveredTrips(visibleGtfsPassages, liveTripIds)

  function clearResults() {
    pending.current?.abort()
    setBusy(false); setResult(null); setLiveTripIds([]); setMessage('')
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearResults()
    if (!line || !stop) { setMessage('Sélectionnez une ligne et un arrêt dans les résultats proposés.'); return }
    if (at && !Number.isFinite(new Date(at).getTime())) { setMessage('Choisissez une date et une heure valides.'); return }
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    try {
      const response = await gtfsApi.passages(line.id, stop.id, at ? new Date(at).toISOString() : undefined, controller.signal)
      if (controller.signal.aborted) return
      if (response.status === 'connected') { setCurrentTime(Date.now()); setResult(response.data); setMetadata(response.data.metadata) }
      else setMessage(response.message)
    } catch { if (!controller.signal.aborted) setMessage('La consultation est indisponible. Réessayez.') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }

  return <section className="panel standalone">
    <span className="section-kicker">ANTICIPER VOTRE DÉPART</span>
    <h2>Horaires et prochains passages</h2>
    <p>Recherchez une ligne et un arrêt TCL. Les horaires GTFS restent disponibles ; les estimations sont affichées séparément lorsqu’elles sont disponibles et vérifiées.</p>
    {metadata ? <div className="feed-metadata"><strong>Horaire théorique</strong><p>Données valables du {dateLabel(metadata.validFrom)} au {dateLabel(metadata.validUntil)} · Heures affichées à Lyon (Europe/Paris).</p><small>GTFS importé le {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(metadata.importedAt))}. Les estimations éventuelles sont identifiées séparément des horaires GTFS.</small></div> : statusLoading ? <p className="message" role="status">Connexion au catalogue GTFS…</p> : <Disconnected title="Catalogue GTFS non disponible">{statusMessage} <button type="button" className="text-button" onClick={() => { setStatusLoading(true); setRetry(value => value + 1) }}>Réessayer la connexion</button></Disconnected>}
    <form onSubmit={search}>
      <div className="time-fields timetable-fields">
        <GtfsSearchField label="Ligne" placeholder="Nom, numéro ou identifiant" selected={line} disabled={!metadata} search={gtfsApi.searchLines} describe={describeLine} onSelect={value => { setLine(value); setStop(null); clearResults() }}/>
        <GtfsSearchField key={line?.id || 'no-line'} label="Arrêt" placeholder="Nom, code ou identifiant" selected={stop} disabled={!metadata || !line} search={searchStops} describe={describeStop} onSelect={value => { setStop(value); clearResults() }}/>
      </div>
      <label className="field timetable-date"><span>Date et heure de consultation (heure de cet appareil)</span><input type="datetime-local" value={at} onChange={event => { setAt(event.target.value); clearResults() }}/></label>
      <p className="search-hint">Laissez vide pour rechercher à partir de maintenant. Recherche limitée aux 24 heures suivantes et aux 12 premiers passages.</p>
      <button className="primary" disabled={busy || !metadata}><Search size={18}/>{busy ? 'Recherche…' : 'Rechercher les passages'}</button>
    </form>
    {message && <p role="status" className="message">{message}</p>}
    {result && <div className="passages-results" aria-live="polite">
      <RealtimePassages key={`${line?.id}-${stop?.id}-${result.queriedAt}`} lineId={line!.id} stopId={stop!.id} lineLabel={line!.shortName || line!.name} stopLabel={stop!.name} historical={Boolean(at)} onVisibleTripsChange={updateLiveTrips}/>
      <h3>{at ? 'Horaires théoriques à la date choisie' : 'Prochains passages théoriques'}</h3>
      <p className="search-hint">Consultation à partir du {departureLabel(result.queriedAt)}.{at ? ' Instantané à la date choisie.' : ' Les passages devenus passés sont retirés de cette liste.'}</p>
      {result.outsideValidity ? <p className="message">La date demandée est hors de la période couverte par les services du GTFS. Aucun horaire ne peut être fourni.</p> : !displayedPassages.length ? <p className="message">{visibleGtfsPassages.length && liveTripIds.length ? 'Les courses GTFS correspondantes sont affichées dans les passages Data Grand Lyon ci-dessus. Leur horaire théorique réapparaît si ces données expirent.' : !at && result.passages.length ? 'Tous les passages de cette liste sont maintenant passés. Relancez la recherche pour consulter les suivants.' : 'Aucun passage théorique permettant la montée n’est prévu pour cette ligne et ce quai dans les 24 heures consultées. Ce constat ne renseigne pas sur le trafic réel.'}</p> : <ul className="passages-list">{displayedPassages.map((passage, index) => <li key={`${passage.tripId}-${passage.serviceDate}-${index}`}>
        <div><strong>{departureLabel(passage.departureTime)}</strong><span>{passage.headsign ? `Direction ${passage.headsign}` : `Direction non renseignée${passage.directionId ? ` (sens ${passage.directionId})` : ''}`}</span>{passage.gtfsSeconds >= 86400 && <small>Service du {dateLabel(passage.serviceDate)} · après minuit</small>}{passage.pickupType >= 2 && <small>Montée sur demande selon le GTFS : contacter l’exploitant.</small>}</div>
        <span className="theoretical-label">Horaire théorique{passage.interpolated ? ' · interpolé par la source' : ''}</span>
      </li>)}</ul>}
    </div>}
    {metadata && metadata.warnings.length > 0 && <details className="feed-warnings"><summary>Informations sur la qualité de l’import ({metadata.warnings.length})</summary><ul>{metadata.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
  </section>
}
