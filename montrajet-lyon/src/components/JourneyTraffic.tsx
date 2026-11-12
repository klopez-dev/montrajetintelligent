import { useEffect, useState } from 'react'
import type { TheoreticalJourney } from '../types/journey'
import { trafficRequest } from '../services/traffic'
import type { JourneyTrafficResponse } from '../services/traffic'
import { TrafficFreshness } from './Traffic'
import { useTrafficClock } from '../hooks/useTrafficClock'

export function JourneyTraffic({ journeys }: { journeys: TheoreticalJourney[] }) {
  // Do not repeatedly serialize IGN geometries when the local expiry clock ticks.
  const key = JSON.stringify(journeys.map(j => ({ legs: j.legs.map(l => ({ tripId: l.tripId, serviceDate: l.serviceDate, from: l.from, to: l.to })) })))
  const [state, setState] = useState<{ key: string; data?: JourneyTrafficResponse; error?: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    if (!JSON.parse(key).length) return
    trafficRequest<JourneyTrafficResponse>({}, controller.signal, JSON.parse(key)).then(data => { if (!controller.signal.aborted) setState({ key, data }) }).catch(e => { if (!controller.signal.aborted) setState({ key, error: e instanceof Error ? e.message : 'Trafic TCL indisponible.' }) })
    return () => controller.abort()
  }, [key])
  const now = useTrafficClock()
  if (!journeys.length) return null
  const current = state?.key === key ? state : null
  const fresh = current?.data?.state === 'available' && !!current.data.validUntil && now < Date.parse(current.data.validUntil)
  return <section className="journey-traffic" aria-label="Vérification des perturbations"><h3>Vigilance trafic TCL</h3>
    {!current && <p role="status">Vérification des annonces officielles, sans retarder l’affichage des itinéraires…</p>}
    {current?.error && <p role="alert">{current.error} Impact des perturbations non déterminable.</p>}
    {current?.data && <><TrafficFreshness snapshot={current.data}/>
      {fresh && current.data.notices?.map((notices, index) => notices.length ? <div key={index} className="traffic-notices"><strong>Proposition {index + 1}</strong>{notices.map(n => <p key={`${n.incidentId}-${n.legIndex}`}><b>{n.level === 'confirmed' ? 'Impact confirmé' : n.level === 'possible' ? 'Impact possible' : 'Information générale'}</b> · Tronçon {n.legIndex + 1} · {n.title}<br/>{n.reason} <a href={n.sourceUrl} target="_blank" rel="noreferrer">Annonce officielle TCL</a></p>)}</div> : null)}
      <p className="search-hint">Vérification partielle : l’absence d’alerte associée ne garantit pas la disponibilité du trajet. Aucune proposition ni horaire alternatif n’est déduit de ces annonces.</p>
    </>}
  </section>
}
