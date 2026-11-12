import type { MobilityResult, WalkPath } from '../types/mobility'
import { JourneyResults } from './JourneyResults'
import { useState } from 'react'
import { JourneyMapSlot } from './JourneyMapSlot'

const clock = (instant: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'shortOffset' }).format(new Date(instant))
const duration = (seconds: number) => `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
function Walk({ path, label }: { path: WalkPath; label: string }) {
  return <div className="journey-connection"><strong>{label}</strong><p>{duration(path.durationSeconds)} estimées · {Math.round(path.distanceMeters)} m sur le réseau piéton IGN BD TOPO.</p><small>Réseau du {path.resourceVersion} · Raccordements au réseau : {Math.ceil(path.startSnapMeters)} / {Math.ceil(path.endSnapMeters)} m (non décrits). Durée estimée, accessibilité et conditions du terrain non vérifiées.</small></div>
}
export function MobilityResults({ result }: { result: MobilityResult }) {
  const [mapIndex,setMapIndex]=useState<number|null>(null)
  const selected=mapIndex===null?null:result.itineraries[mapIndex]
  const limitReasons = result.warnings.filter(warning => warning.startsWith('Budget de ') || warning.startsWith('Six nouveaux liens'))
  return <section className="mobility-results" aria-label="Résultats porte-à-porte" aria-live="polite">
    <h3>{result.itineraries.length} proposition(s) avec marche estimée</h3>
    {!!result.providerIssues?.length && <div className="message error" role="alert"><strong>Certains accès IGN n’ont pas pu être confirmés.</strong><p>{result.providerIssues[0].message}</p><small>Ces accès sont exclus. Les propositions restantes utilisent uniquement des données validées.</small></div>}
    {result.state !== 'ok' && <p className="message" role="status">{result.state === 'limited' ? <>Exploration partielle : les propositions affichées sont contrôlées, mais le meilleur trajet global n'est pas garanti. {limitReasons.slice(0, 2).join(' ')} Consultez les limites ci-dessous.</> : result.state === 'outside_validity' ? 'Date hors validité du GTFS.' : 'Aucun trajet confirmé dans le périmètre retenu. Consultez les limites et les accès exclus ci-dessous.'}</p>}
    {selected&&<><button type="button" className="secondary" onClick={()=>setMapIndex(null)}>Fermer la carte</button><JourneyMapSlot journey={selected.transit} door={selected} feedSha256={selected.transitResult.metadata.sha256}/></>}
    {result.itineraries.map((item, index) => <article data-journey-id={item.transit.id} className={'journey-proposal'+(mapIndex===index?' map-selected-proposal':'')} key={`${item.transit.id}-${index}`}>
      <button type="button" className="secondary show-journey-map" aria-pressed={mapIndex===index} onClick={()=>setMapIndex(index)}>Voir la proposition {index+1} sur la carte</button>
      <details className="door-proposal-details" open={index === 0}><summary><strong>Proposition porte-à-porte {index + 1} · {item.transit.legs.map(leg => leg.lineName).join(' → ')}</strong><span>{clock(item.departureTime)} → {clock(item.arrivalTime)}<br/>{duration(item.durationSeconds)} · {item.transit.transfers} correspondance(s)</span></summary>
      <p><strong>Départ recommandé {item.access ? 'du domicile' : 'du quai'} : {clock(item.departureTime)}</strong><br/>Arrivée à destination : {clock(item.arrivalTime)}</p>
      <p>Durée totale : {duration(item.durationSeconds)} · {item.transit.transfers} correspondance(s).<br/>Marche {item.unknownTransferWalking ? 'connue au minimum' : 'estimée'} : {duration(item.walkingSeconds)}.<br/>Attente et marges pendant le trajet : {item.waitingSeconds === null ? 'non séparables du minimum officiel GTFS' : duration(item.waitingSeconds)}.</p>
      {item.access && <><p>{item.fromName} → {item.transit.legs[0].from.name} (quai {item.transit.legs[0].from.id}). Marge avant embarquement : {duration(item.safetySeconds)}.</p><Walk path={item.access} label="Marche initiale"/></>}
      <JourneyResults embedded result={{ ...item.transitResult, itineraries: [{ ...item.transit, initialWaitSeconds: 0 }], warnings: item.transitResult.warnings.filter(warning => !warning.includes('Pas de marche d’accès')) }}/>
      {item.egress && <><p>{item.transit.legs.at(-1)!.to.name} → {item.toName}</p><Walk path={item.egress} label="Marche finale"/></>}
      </details>
    </article>)}
    <p className="search-hint">Adresses : BAN via IGN · Réseau piéton : IGN BD TOPO · Transports : GTFS TCL importé. <a href="https://cartes.gouv.fr/cgu/" target="_blank" rel="noreferrer">Conditions IGN</a></p>
    <details className="feed-warnings"><summary>Périmètre, hypothèses et accès exclus</summary><ul>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>
  </section>
}

