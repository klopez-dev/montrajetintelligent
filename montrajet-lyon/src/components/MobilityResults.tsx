import { useState } from 'react'
import { ArrowRight, BusFront, ChevronDown, Clock3, Footprints, Map, MapPin, Route } from 'lucide-react'
import type { DoorJourney, MobilityResult, WalkPath } from '../types/mobility'
import { JourneyMapSlot } from './JourneyMapSlot'

const time = (instant: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(instant))
const minutes = (seconds: number) => `${Math.max(0, Math.round(seconds / 60))} min`
const transferCount = (count: number) => count === 0 ? 'Direct' : `${count} correspondance${count > 1 ? 's' : ''}`

function WalkingStep({ path, title, from, to }: { path: WalkPath; title: string; from: string; to: string }) {
  return <li className="mtl-step">
    <span className="mtl-step-icon"><Footprints size={17}/></span>
    <div><strong>{title} · {minutes(path.durationSeconds)}</strong><p>{from} → {to}</p>
      <details className="mtl-technical"><summary>Détails du parcours piéton</summary><p>{Math.round(path.distanceMeters)} m · {path.source} · réseau {path.resourceVersion}</p><p>Raccordements : {Math.ceil(path.startSnapMeters)} m / {Math.ceil(path.endSnapMeters)} m. Durée estimée ; accessibilité et terrain non vérifiés.</p></details>
    </div>
  </li>
}

function JourneyTimeline({ item }: { item: DoorJourney }) {
  const legs = item.transit.legs
  return <ol className="mtl-timeline">
    {item.access && <WalkingStep path={item.access} title="Rejoindre l'arrêt" from={item.fromName} to={legs[0].from.name}/>}
    {legs.map((leg, index) => {
      const connection = index > 0 ? (item.transit.connections?.[index] ?? (index === 1 ? item.transit.connection : null)) : null
      const previous = index > 0 ? legs[index - 1] : null
      const interval = previous ? Math.max(0, Math.round((new Date(leg.departureTime).getTime() - new Date(previous.arrivalTime).getTime()) / 1000)) : 0
      return <li className="mtl-step" key={`${leg.tripId}-${index}`}>
        <span className="mtl-step-icon"><BusFront size={17}/></span>
        <div className="mtl-step-content">
          {previous && <div className="mtl-change"><strong>Correspondance à {previous.to.name}</strong><span>{minutes(interval)} entre les véhicules{connection?.fromStopId !== connection?.toStopId && connection ? ' · changement de quai ou d’arrêt' : ''}</span>{interval <= 180 && <span className="mtl-tight">Correspondance courte : vérifiez les horaires</span>}</div>}
          <div className="mtl-leg-heading"><span className="mtl-line">{leg.lineName}</span><strong>{time(leg.departureTime)} · {leg.from.name}</strong></div>
          <p>Direction {leg.headsign || 'non renseignée'}</p>
          <p className="mtl-arrival">{time(leg.arrivalTime)} · Descendre à {leg.to.name}</p>
          <details className="mtl-technical"><summary>Informations techniques</summary><p>Quai de départ : {leg.from.id} · Quai d'arrivée : {leg.to.id} · Service : {leg.serviceDate}</p>{leg.interpolatedBySource && <p>Horaire interpolé par la source GTFS.</p>}{connection && <p>Correspondance : {connection.fromStopName} → {connection.toStopName} · minimum officiel : {minutes(connection.officialMinimumSeconds)} · marge : {minutes(connection.spareSeconds)}. {connection.walkingSeconds === null ? 'Marche incluse dans le minimum officiel.' : `Marche estimée : ${minutes(connection.walkingSeconds)}.`}</p>}</details>
        </div>
      </li>
    })}
    {item.egress && <WalkingStep path={item.egress} title="Rejoindre la destination" from={legs[legs.length - 1].to.name} to={item.toName}/>}
    <li className="mtl-step mtl-destination"><span className="mtl-step-icon"><MapPin size={17}/></span><div><strong>{time(item.arrivalTime)} · Arrivée</strong><p>{item.toName}</p></div></li>
  </ol>
}

export function MobilityResults({ result }: { result: MobilityResult }) {
  const [mapIndex, setMapIndex] = useState<number | null>(null)
  const selected = mapIndex === null ? null : result.itineraries[mapIndex]
  return <section className="mobility-results mtl-results" aria-label="Résultats porte-à-porte" aria-live="polite">
    <div className="mtl-results-heading"><h3>{result.itineraries.length} trajet{result.itineraries.length > 1 ? 's' : ''} proposé{result.itineraries.length > 1 ? 's' : ''}</h3><span>Horaires théoriques</span></div>
    {result.state === 'limited' && <p className="mtl-notice" role="status">Recherche partielle : d'autres trajets peuvent exister. Le meilleur trajet n'est pas garanti.</p>}
    {result.state === 'outside_validity' && <p className="message" role="status">Date hors validité des horaires GTFS.</p>}
    {result.state === 'no_journey' && <p className="message" role="status">Aucun trajet confirmé dans le périmètre recherché.</p>}
    {!!result.providerIssues?.length && <p className="mtl-notice" role="status">Certains accès piétons n'ont pas pu être vérifiés et ont été exclus.</p>}
    {selected && <div className="mtl-map-container"><button type="button" className="secondary" onClick={() => setMapIndex(null)}>Fermer la carte</button><JourneyMapSlot journey={selected.transit} door={selected} feedSha256={selected.transitResult.metadata.sha256}/></div>}
    <div className="mtl-cards">{result.itineraries.map((item, index) => <article key={`${item.transit.id}-${index}`} data-journey-id={item.transit.id} className={`journey-proposal mtl-card${mapIndex === index ? ' map-selected-proposal' : ''}`}>
      <div className="mtl-card-top"><span>Trajet {index + 1}</span><span><Clock3 size={13}/> Théorique</span></div>
      <div className="mtl-time-row"><strong>{time(item.departureTime)}</strong><ArrowRight size={18} aria-hidden="true"/><strong>{time(item.arrivalTime)}</strong><span>{minutes(item.durationSeconds)}</span></div>
      <div className="mtl-lines"><span className="mtl-walk"><Footprints size={15}/> {minutes(item.walkingSeconds)}{item.unknownTransferWalking ? ' au minimum' : ''}</span>{item.transit.legs.map((leg, i) => <span className="mtl-line" key={`${leg.tripId}-${i}`}>{leg.lineName}</span>)}<span className="mtl-transfer"><Route size={14}/> {transferCount(item.transit.transfers)}</span></div>
      <div className="mtl-actions"><details className="mtl-journey-details"><summary>Voir les étapes <ChevronDown size={16}/></summary><JourneyTimeline item={item}/><details className="mtl-technical mtl-journey-technical"><summary>Autres informations de calcul</summary><p>Marche {item.unknownTransferWalking ? 'connue au minimum' : 'estimée'} : {minutes(item.walkingSeconds)}. Attente : {item.waitingSeconds === null ? 'incluse dans les minima GTFS, non isolable' : minutes(item.waitingSeconds)}.</p><p>Les horaires proviennent du GTFS TCL importé. Aucune confirmation en temps réel.</p></details></details><button type="button" className="secondary mtl-map-button" aria-pressed={mapIndex === index} onClick={() => setMapIndex(mapIndex === index ? null : index)}><Map size={16}/> {mapIndex === index ? 'Masquer la carte' : 'Voir la carte'}</button></div>
    </article>)}</div>
    <p className="mtl-source">Horaires théoriques TCL · Marche estimée sur OpenStreetMap. <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">Attribution OSM</a></p>
    <details className="feed-warnings mtl-global-technical"><summary>Sources, limites et hypothèses de calcul</summary><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}{result.providerIssues?.map((issue, index) => <li key={`provider-${index}`}>{issue.source} : {issue.message}</li>)}</ul><p>Durée du calcul : {Math.round(result.metrics.durationMs)} ms · Recherches transport : {result.metrics.transitSearches} · Appels piétons : {result.metrics.walkingCalls}</p></details>
  </section>
}
