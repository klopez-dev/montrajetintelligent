import { useState } from 'react'
import type { RoutingResult } from '../../../src/types/journey.ts'
import { JourneyMapSlot } from '../../../src/components/JourneyMapSlot.tsx'
import { JourneyCard } from './JourneyCard.tsx'
import { toggleSummaryOnEnter } from './accessibility.ts'

export function JourneyResults({result}:{result:RoutingResult}){
 const [mapIndex,setMapIndex]=useState<number|null>(null)
 const selected=mapIndex===null?null:result.itineraries[mapIndex]
 return <section className="journey-results ux-results" aria-label="Résultats d’itinéraires" aria-live="polite">
   <header className="ux-results-heading"><div><span className="section-kicker">VOTRE PARCOURS</span><h3>{result.itineraries.length} proposition{result.itineraries.length!==1?'s':''} théorique{result.itineraries.length!==1?'s':''}</h3></div><p>Horaires théoriques GTFS · Lyon, Europe/Paris</p></header>
   {result.state==='limited'&&<p className="ux-partial" role="status">Recherche partielle : d’autres itinéraires peuvent exister. <a href="#ux-transit-limits">Voir les limites</a></p>}
   {result.state==='outside_validity'&&<p className="message" role="status">La date demandée est hors de la validité des services GTFS.</p>}
   {result.state==='no_journey'&&<p className="message" role="status">Aucun trajet trouvé dans ce périmètre : six heures, {result.scope.maxTransfers} correspondance(s) maximum et transferts vérifiables. Cela ne signifie pas qu’aucun trajet n’existe sur tout le réseau.</p>}
   {selected&&<div className="ux-map-panel"><button type="button" className="secondary" onClick={()=>setMapIndex(null)}>Fermer la carte</button><JourneyMapSlot journey={selected} feedSha256={result.metadata.sha256}/></div>}
   <div className="ux-cards">{result.itineraries.map((journey,index)=><JourneyCard key={`${journey.id}-${index}`} journey={journey} index={index} mapSelected={mapIndex===index} onMap={()=>setMapIndex(index)}/>)}</div>
   <details id="ux-transit-limits" className="feed-warnings ux-feed"><summary onKeyDown={toggleSummaryOnEnter}>Périmètre, validité et hypothèses</summary><p>GTFS valable du {result.metadata.validFrom} au {result.metadata.validUntil}. Aucune confirmation de circulation en temps réel.</p><ul>{result.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></details>
 </section>
}
