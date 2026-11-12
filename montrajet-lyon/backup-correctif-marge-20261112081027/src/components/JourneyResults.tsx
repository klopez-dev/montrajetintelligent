import { ArrowRight, TrainFront } from 'lucide-react'
import { useState } from 'react'
import { JourneyMapSlot } from './JourneyMapSlot'
import type { JourneyTransfer, RoutingResult } from '../types/journey'

const journeyTime = (time: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'shortOffset' }).format(new Date(time))
function duration(seconds: number) {
  const rounded = Math.round(seconds)
  const minutes = Math.floor(rounded / 60), rest = rounded % 60
  return `${minutes} min${rest ? ` ${rest} s` : ''}`
}
function mode(type: number) { return ({ 0: 'Tramway', 1: 'Métro', 2: 'Train', 3: 'Bus', 7: 'Funiculaire', 11: 'Trolleybus', 12: 'Monorail', 700: 'Bus', 701: 'Bus régional', 702: 'Bus express', 703: 'Bus', 704: 'Bus local', 705: 'Bus de nuit', 711: 'Navette bus', 712: 'Bus scolaire', 713: 'Bus scolaire et public', 714: 'Bus de substitution', 715: 'Bus à la demande', 716: 'Bus', 800: 'Trolleybus', 900: 'Tramway', 1400: 'Funiculaire' } as Record<number, string>)[type] || `Transport GTFS ${type}` }
function TransferDetails({ connection }: { connection: JourneyTransfer }) {
  return <div className="journey-connection">
    <strong>Correspondance : {connection.fromStopName}{connection.fromStopId !== connection.toStopId ? ` → ${connection.toStopName}` : ''}</strong>
    <p>Quai {connection.fromStopId} → quai {connection.toStopId}. Intervalle entre véhicules : {duration(connection.intervalSeconds)}.</p>
    <p>{connection.source === 'gtfs' ? `Minimum officiel GTFS : ${duration(connection.officialMinimumSeconds)}. ` : connection.source === 'ign_pedestrian' ? `Parcours piéton estimé : ${duration(connection.walkingSeconds!)}. ` : 'Même quai : déplacement interarrêt nul retenu comme hypothèse. '}{connection.source === 'gtfs' && connection.walkingSeconds !== null && connection.walkingSeconds > connection.officialMinimumSeconds ? `Marche piétonne plus longue retenue : ${duration(connection.walkingSeconds)}. ` : ''}Marge ajoutée : {duration(connection.marginSeconds)}. Temps restant après minimum et marge : {duration(connection.spareSeconds)}.</p>
    <p>Marche : {connection.walkingSeconds === null ? 'incluse dans le minimum officiel ; durée seule non détaillée par le GTFS.' : connection.walkingPath ? `${duration(connection.walkingSeconds)} estimées · ${Math.round(connection.walkingPath.distanceMeters)} m · réseau ${connection.walkingPath.resourceVersion}.` : '0 min entre arrêts, même quai (hypothèse).'}</p>
  </div>
}
export function JourneyResults({ result, embedded = false }: { result: RoutingResult; embedded?: boolean }) {
  const [mapIndex,setMapIndex]=useState<number|null>(null)
  const selected=mapIndex===null?null:result.itineraries[mapIndex]
  return <section className="journey-results" aria-label="Résultats d’itinéraires" aria-live="polite">
    <h3>{embedded ? 'Transports à emprunter' : `${result.itineraries.length} proposition${result.itineraries.length !== 1 ? 's' : ''} théorique${result.itineraries.length !== 1 ? 's' : ''}`}</h3>
    <p className="search-hint">Heures à Lyon (Europe/Paris). GTFS valable du {result.metadata.validFrom} au {result.metadata.validUntil}. Aucune confirmation de circulation en temps réel.</p>
    {result.state !== 'ok' && <p className="message" role="status">{result.state === 'limited' ? 'Exploration partielle : un budget de calcul a été atteint. Les propositions affichées sont contrôlées, mais le classement ne couvre pas tous les parcours possibles.' : result.state === 'outside_validity' ? 'La date demandée est hors de la validité des services GTFS.' : `Aucun trajet trouvé dans ce périmètre : six heures, ${result.scope.maxTransfers} correspondance(s) maximum et transferts vérifiables. Cela ne signifie pas qu’aucun trajet n’existe sur tout le réseau.`}</p>}
    {!embedded && selected && <><button type="button" className="secondary" onClick={()=>setMapIndex(null)}>Fermer la carte</button><JourneyMapSlot journey={selected} feedSha256={result.metadata.sha256}/></>}
    <ol className="journey-proposals">{result.itineraries.map((journey, index) => <li key={journey.id} data-journey-id={journey.id} className={'journey-proposal'+(!embedded&&mapIndex===index?' map-selected-proposal':'')}>
      {!embedded&&<button type="button" className="secondary show-journey-map" aria-pressed={mapIndex===index} onClick={()=>setMapIndex(index)}>Voir la proposition {index+1} sur la carte</button>}
      <div className="proposal-heading">{!embedded && <strong>Proposition {index + 1}</strong>}<span className="theoretical-label">Horaire théorique</span></div>
      <div className="journey-times"><time dateTime={journey.departureTime}>{journeyTime(journey.departureTime)}</time><ArrowRight size={16}/><time dateTime={journey.arrivalTime}>{journeyTime(journey.arrivalTime)}</time></div>
      <p className="journey-summary">{duration(journey.durationSeconds)} · {journey.transfers === 0 ? 'Direct' : `${journey.transfers} correspondance${journey.transfers > 1 ? 's' : ''}`}</p>
      <p className="search-hint">{journey.legs.map(leg => `${leg.lineName} direction ${leg.headsign || 'non renseignée'}`).join(' · ')}</p>
      {journey.initialWaitSeconds > 0 && <p className="search-hint">Attente avant le premier départ : {duration(journey.initialWaitSeconds)} (hors durée du trajet).</p>}
      <details className="journey-detail" open={index === 0}><summary>Étapes, attente et correspondance</summary>
      {journey.legs.map((leg, legIndex) => <div key={`${leg.tripId}-${legIndex}`} className="journey-leg">
        <h4><TrainFront size={17}/><span>{mode(leg.routeType)} <b>{leg.lineName}</b></span></h4>
        <p>Direction {leg.headsign || `non renseignée (sens ${leg.directionId || 'inconnu'})`}</p>
        <p><strong>{leg.from.name}</strong> <small>quai {leg.from.id}</small><br/>{journeyTime(leg.departureTime)} → {journeyTime(leg.arrivalTime)}<br/><strong>{leg.to.name}</strong> <small>quai {leg.to.id}</small></p>
        <small>Service du {leg.serviceDate}{leg.departureGtfsSeconds >= 86400 || leg.arrivalGtfsSeconds >= 86400 ? ' · horaire après minuit du jour de service' : ''}{leg.interpolatedBySource ? ' · horaire interpolé par la source GTFS' : ''}</small>
        {(journey.connections?.[legIndex] ?? (legIndex === 0 ? journey.connection : null)) && <TransferDetails connection={(journey.connections?.[legIndex] ?? journey.connection)!}/>}
      </div>)}</details>
    </li>)}</ol>
    {!embedded && <details className="feed-warnings"><summary>Périmètre et hypothèses de calcul</summary><ul>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
  </section>
}
