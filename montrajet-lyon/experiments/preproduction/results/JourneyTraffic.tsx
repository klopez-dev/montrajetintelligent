import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { TheoreticalJourney } from '../../../src/types/journey.ts'
import { trafficRequest } from '../../../src/services/traffic.ts'
import type { JourneyTrafficResponse } from '../../../src/services/traffic.ts'
import { TrafficFreshness } from '../../../src/components/Traffic.tsx'
import { useTrafficClock } from '../../../src/hooks/useTrafficClock.ts'
import { toggleSummaryOnEnter } from './accessibility.ts'

export function JourneyTraffic({journeys}:{journeys:TheoreticalJourney[]}){
 const key=JSON.stringify(journeys.map(j=>({legs:j.legs.map(l=>({tripId:l.tripId,serviceDate:l.serviceDate,from:l.from,to:l.to}))})))
 const [state,setState]=useState<{key:string;data?:JourneyTrafficResponse;error?:string}|null>(null)
 useEffect(()=>{const controller=new AbortController(),payload=JSON.parse(key) as TheoreticalJourney[];if(!payload.length)return;trafficRequest<JourneyTrafficResponse>({},controller.signal,payload).then(data=>{if(!controller.signal.aborted)setState({key,data})}).catch(e=>{if(!controller.signal.aborted)setState({key,error:e instanceof Error?e.message:'Trafic TCL indisponible.'})});return()=>controller.abort()},[key])
 const now=useTrafficClock(),current=state?.key===key?state:null,fresh=current?.data?.state==='available'&&!!current.data.validUntil&&now<Date.parse(current.data.validUntil)
 if(!journeys.length)return null
 return <section className="journey-traffic ux-traffic" aria-label="Vigilance trafic TCL"><div className="ux-traffic-summary"><TriangleAlert aria-hidden="true" size={18}/><div><strong>{!current?'Vérification du trafic…':fresh?'Trafic : consulter les annonces disponibles':'Trafic non vérifié'}</strong><p>{fresh?'Couverture partielle : les trajets doivent être examinés.':'L’état du réseau ne peut pas être déduit des données disponibles.'}</p></div></div>
   <details><summary onKeyDown={toggleSummaryOnEnter}>Détails du trafic et source officielle</summary>{!current&&<p role="status">Vérification des annonces, sans retarder les itinéraires…</p>}{current?.error&&<p role="alert">{current.error} Impact des perturbations non déterminable.</p>}{current?.data&&<><TrafficFreshness snapshot={current.data}/>{fresh&&current.data.notices?.map((notices,index)=>notices.length?<div key={index} className="traffic-notices"><strong>Proposition {index+1}</strong>{notices.map(n=><p key={`${n.incidentId}-${n.legIndex}`}><b>{n.level==='confirmed'?'Impact confirmé':n.level==='possible'?'Impact possible':'Information générale'}</b> · Tronçon {n.legIndex+1} · {n.title}<br/>{n.reason} <a href={n.sourceUrl} target="_blank" rel="noreferrer">Annonce officielle TCL</a></p>)}</div>:null)}<p className="search-hint">Vérification partielle : l’absence d’alerte associée ne garantit pas la disponibilité du trajet. Aucun horaire alternatif n’est déduit de ces annonces.</p></>}</details>
 </section>
}
