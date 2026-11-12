import { useState } from 'react'
import type { MobilityResult } from '../../../src/types/mobility.ts'
import { JourneyMapSlot } from '../../../src/components/JourneyMapSlot.tsx'
import { JourneyCard } from './JourneyCard.tsx'
import { toggleSummaryOnEnter } from './accessibility.ts'

export function MobilityResults({result}:{result:MobilityResult}){
 const [mapIndex,setMapIndex]=useState<number|null>(null)
 const selected=mapIndex===null?null:result.itineraries[mapIndex]
 return <section className="journey-results mobility-results ux-results" aria-label="Résultats porte-à-porte" aria-live="polite">
   <header className="ux-results-heading"><div><span className="section-kicker">DE PORTE À PORTE</span><h3>{result.itineraries.length} proposition{result.itineraries.length!==1?'s':''} avec marche estimée</h3></div><p>Transports théoriques GTFS · marche estimée IGN</p></header>
   {!!result.providerIssues?.length&&<div className="message error" role="alert"><strong>Certains accès IGN n’ont pas pu être confirmés.</strong><p>{result.providerIssues[0].message}</p><small>Ces accès sont exclus. Les propositions restantes utilisent uniquement des données validées.</small></div>}
   {result.state==='limited'&&<p className="ux-partial" role="status">Recherche partielle : d’autres itinéraires peuvent exister. <a href="#ux-door-limits">Voir les limites</a></p>}
   {result.state==='outside_validity'&&<p className="message" role="status">Date hors validité du GTFS.</p>}
   {result.state==='no_journey'&&<p className="message" role="status">Aucun trajet confirmé dans le périmètre retenu. Consultez les limites et les accès exclus ci-dessous.</p>}
   {selected&&<div className="ux-map-panel"><button type="button" className="secondary" onClick={()=>setMapIndex(null)}>Fermer la carte</button><JourneyMapSlot journey={selected.transit} door={selected} feedSha256={selected.transitResult.metadata.sha256}/></div>}
   <div className="ux-cards">{result.itineraries.map((item,index)=><JourneyCard key={`${item.transit.id}-${index}`} journey={item.transit} door={item} index={index} mapSelected={mapIndex===index} onMap={()=>setMapIndex(index)}/>)}</div>
   <p className="search-hint">Adresses : BAN via IGN · Réseau piéton : IGN BD TOPO · Transports : GTFS TCL importé. <a href="https://cartes.gouv.fr/cgu/" target="_blank" rel="noreferrer">Conditions IGN</a></p>
   <details id="ux-door-limits" className="feed-warnings ux-feed"><summary onKeyDown={toggleSummaryOnEnter}>Périmètre, validité, hypothèses et accès exclus</summary><p>GTFS valable du {result.itineraries[0]?.transitResult.metadata.validFrom||'date non renseignée'} au {result.itineraries[0]?.transitResult.metadata.validUntil||'date non renseignée'}. Transport théorique ; temps réel non connecté.</p><ul>{result.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></details>
 </section>
}
