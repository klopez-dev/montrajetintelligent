import { useEffect, useState } from 'react'
import { searchStageLabels } from '../types/searchProgress'
import type { SearchProgress } from '../types/searchProgress'

/** Only server events name a stage. Elapsed time measures waiting, never completion. */
export function JourneyProgress({ events, started, onCancel }: { events: SearchProgress[]; started: number; onCancel: () => void }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const update = () => setSeconds(Math.floor((Date.now() - started) / 1000))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [started])
  const current = events.at(-1)
  return <div className="journey-progress" aria-label="Suivi du calcul">
    <p role="status" aria-live="polite" {...(current ? { 'data-server-stage': current.stage } : {})}>
      <strong>{current ? searchStageLabels[current.stage] : 'Connexion au calculateur…'}</strong>
    </p>
    {events.length > 1 && <ul aria-label="Étapes signalées par le serveur">{events.slice(0, -1).map((event, index) => <li key={`${event.stage}-${index}`}>{searchStageLabels[event.stage]}</li>)}</ul>}
    <div className="progress-actions"><span aria-live="off">Attente écoulée : {seconds} s</span><button type="button" className="cancel-search" onClick={onCancel}>Annuler la recherche</button></div>
    <small>Les accès piétons IGN peuvent allonger le premier calcul.</small>
  </div>
}
