import { useEffect, useState } from 'react'
import type { RealtimeResult } from '../types/realtime'
import { currentEstimates, fetchRealtime, preferFreshResult } from '../services/realtime'

const label = (time: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(time))

/** Bloc indépendant : une erreur du fournisseur ne retire jamais la liste GTFS. */
export function RealtimePassages({ lineId, stopId, lineLabel, stopLabel, historical, onVisibleTripsChange }: { lineId: string; stopId: string; lineLabel: string; stopLabel: string; historical: boolean; onVisibleTripsChange?: (ids: string[]) => void }) {
  const [result, setResult] = useState<RealtimeResult | null>(null)
  const [loading, setLoading] = useState(!historical)
  const [retry, setRetry] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    if (historical) return
    const controller = new AbortController()
    fetchRealtime(lineId, stopId, controller.signal).then(value => {
      if (controller.signal.aborted) return
      const now = Date.now()
      setClock(now); setResult(previous => preferFreshResult(previous, value, now)); setLoading(false)
    }).catch(() => { /* Requête annulée lors du changement de sélection. */ })
    return () => controller.abort()
  }, [lineId, stopId, historical, retry])
  useEffect(() => {
    if (!result || historical) return
    const update = () => setClock(Date.now())
    const expirations = result.estimates.map(row => Math.min(Date.parse(row.validUntil), Date.parse(row.estimatedTime))).filter(time => time > clock)
    const timer = expirations.length ? window.setTimeout(update, Math.max(1, Math.min(...expirations) - Date.now())) : null
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', update); window.removeEventListener('focus', update)
    }
  }, [result, historical, clock])
  useEffect(() => {
    if (historical || loading || !result || result.validationMode || !['available', 'no_estimates'].includes(result.state)) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      setLoading(true); setRetry(value => value + 1)
    }, 120_000)
    return () => window.clearInterval(timer)
  }, [historical, loading, result])
  const estimates = result ? currentEstimates(result.estimates, clock) : []
  useEffect(() => {
    onVisibleTripsChange?.((result ? currentEstimates(result.estimates, clock) : []).map(row => row.tripId))
    return () => onVisibleTripsChange?.([])
  }, [result, clock, historical, onVisibleTripsChange])
  if (historical) return <p className="search-hint realtime-status">Les estimations temps réel concernent uniquement une recherche « maintenant ». Cette consultation datée reste théorique.</p>
  return <section className="realtime-panel" aria-label="Estimations temps réel" aria-busy={loading}>
    <h3>Passages Data Grand Lyon</h3>
    <p className="search-hint">Ligne {lineLabel} · arrêt {stopLabel}</p>
    {result?.validationMode && <p className="search-hint">Validation locale ponctuelle · aucun rafraîchissement automatique.</p>}
    {loading && <p role="status" className="search-hint">Consultation des estimations… Les horaires GTFS restent disponibles ci-dessous.</p>}
    {result && <>
      <p className="search-hint" role="status">{result.state === 'available' && !estimates.length ? 'Les passages reçus ont expiré. Aucun passage actualisé n’est affiché ; consultez les horaires GTFS ci-dessous.' : result.message}</p>
      <p className="search-hint">Dernière actualisation de la source : {result.sourceUpdatedAt ? label(result.sourceUpdatedAt) : 'indisponible'}. {result.fetchedAt && `Dernière réception : ${label(result.fetchedAt)}.`}</p>
      {estimates.length > 0 && <ul className="passages-list realtime-list">{(showAll ? estimates : estimates.slice(0, 5)).map(row => <li key={`${row.tripId}-${row.estimatedTime}`}>
        <div><strong>{label(row.estimatedTime)}</strong><span>{row.directionReliable ? `Direction ${row.headsign}` : "Direction non confirmée par le GTFS"}</span><small>Actualisation source : {label(row.sourceUpdatedAt)}</small></div>
        <span className="estimated-label">{row.kind === "estimated" ? "Passage estimé · Data Grand Lyon" : "Horaire théorique · Data Grand Lyon"}</span>
      </li>)}</ul>}
      {estimates.length > 5 && <button type="button" className="text-button" onClick={() => setShowAll(value => !value)}>{showAll ? 'Voir moins de passages' : `Voir les ${estimates.length} passages`}</button>}
    </>}
    <button type="button" className="text-button" disabled={loading} onClick={() => { setLoading(true); setRetry(value => value + 1) }}>Actualiser les estimations</button>
  </section>
}
