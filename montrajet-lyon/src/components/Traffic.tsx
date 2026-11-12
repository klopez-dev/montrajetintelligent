import { temporalStatus } from '../services/trafficTime'
import { useTrafficClock } from '../hooks/useTrafficClock'
import { coverageAt, coverageSummary } from '../services/trafficCoverage'
import { useEffect, useState } from 'react'
import { trafficRequest } from '../services/traffic'
import type { TrafficSnapshot, TrafficIncident } from '../types/traffic'

const when = (value: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
export function TrafficFreshness({ snapshot }: { snapshot: TrafficSnapshot }) {
  const now = useTrafficClock()
  if (snapshot.state === 'available' && snapshot.validUntil && now >= Date.parse(snapshot.validUntil)) snapshot = { ...snapshot, state: 'stale' }
  return <div className="traffic-freshness">
    <p className={snapshot.state === 'available' ? 'message' : 'message error'} role="status">{snapshot.state === 'available' ? 'Informations officielles récupérées · couverture partielle.' : snapshot.state === 'stale' ? 'Données anciennes : le fournisseur n’a pas pu être actualisé. Ne pas les considérer comme l’état actuel du réseau.' : 'Données indisponibles : l’état du réseau ne peut pas être déterminé.'}</p>
    {snapshot.error && <p role="alert" className="message error">{snapshot.error}</p>}
    <p className="search-hint">Dernière récupération valide : {snapshot.fetchedAt ? when(snapshot.fetchedAt) : 'aucune'}. Date de publication ou de mise à jour des annonces : non fournie par ces fiches.<br/>Lignes consultées : {snapshot.coverage.join(', ') || 'aucune couverture confirmée'}. Le reste du réseau n’est pas couvert.</p>
    <a href={snapshot.sourceUrl} target="_blank" rel="noreferrer">Consulter l’état officiel sur TCL.fr</a>
  </div>
}
function Incident({ incident }: { incident: TrafficIncident }) {
  return <article className="traffic-incident">
    <h4>{incident.title}</h4><p>{incident.lines.map(l => l.label).join(' · ')} · {incident.officialSeverity || 'Gravité non renseignée'}</p>
    <p className="search-hint">Correspondance GTFS : {incident.mapping === 'exact' ? 'identifiants vérifiés' : incident.mapping === 'partial' ? 'partielle, code commercial et mode uniquement' : 'non établie'}. Quais et directions : {incident.stops?.length ? 'consulter les identifiants détaillés' : 'non identifiés de façon structurée' }.</p>
    <details><summary>Lire l’annonce officielle complète</summary><p className="traffic-original">{incident.description}</p>
      {!!incident.explicitDetails?.length && <div><h5>Éléments explicitement écrits dans l’annonce</h5>{incident.explicitDetails.map((detail, i) => <p key={i}><strong>{{ direction: 'Direction', unserved: 'Non-desserte', relocated: 'Déplacement', replacement: 'Remplacement', diversion: 'Déviation', frequency: 'Fréquence' }[detail.kind]} :</strong> {detail.text}</p>)}<p className="search-hint">Extraits littéraux ; aucun identifiant de quai ou de direction GTFS n’en est déduit.</p></div>}
      <p><strong>Plage officielle :</strong> {incident.periodText || 'Non précisée'}</p>
      {incident.temporalPrecision !== 'exact' && <p className="search-hint">Dates ou récurrences non interprétées avec certitude : le texte original fait référence.</p>}
      <p>Arrêts non desservis, directions et solutions de remplacement : consulter le texte officiel ci-dessus ; aucun report déduit automatiquement.</p>
      {incident.relatedUrls.map(url => <p key={url}><a href={url} target="_blank" rel="noreferrer">Information complémentaire TCL</a></p>)}
      <p className="search-hint">contenu extrait du site TCL.fr – date de mise à jour non fournie ; récupération le {when(incident.fetchedAt)}.</p>
      <a href={incident.sourceUrl} target="_blank" rel="noreferrer">Source officielle de cette annonce</a>
    </details>
  </article>
}
export function Traffic() {
  const [line, setLine] = useState(''), [mode, setMode] = useState(''), [date, setDate] = useState(''), [refresh, setRefresh] = useState(0)
  const [snapshot, setSnapshot] = useState<TrafficSnapshot | null>(null), [busy, setBusy] = useState(true), [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setBusy(true); setError('')
      trafficRequest({ line, mode, date }, controller.signal).then(data => { if (!controller.signal.aborted) setSnapshot(data) }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Trafic indisponible.') }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [line, mode, date, refresh])
  const now = useTrafficClock()
  const rows = coverageAt(snapshot?.lineCoverage || [], now), counts = coverageSummary(rows)
  const visibleRows = rows.filter(r => (!line || r.line.toUpperCase().includes(line.toUpperCase())) && (!mode || r.mode === mode) && (line || r.state !== 'not_checked' || ['C13','C9','C16','125','T3','A','D'].includes(r.line)))
  const fresh = (i: TrafficIncident) => snapshot?.state === 'available' && (!snapshot.validUntil || now < Date.parse(snapshot.validUntil)) && (!snapshot.lineCoverage || i.lines.some(l => rows.some(r => r.line === l.label && ['with_announcements','without_announcements'].includes(r.state))))
  const groups: [TrafficIncident['status'], string][] = [['active', 'En cours'], ['future', 'À venir'], ['undetermined', 'Période à vérifier dans l’annonce'], ['ended', 'Terminées dans les données consultées']]
  return <section className="panel standalone traffic-panel"><span className="section-kicker">INFORMATION RÉSEAU</span><h2>Perturbations TCL</h2>
    <p>Fiches publiques officielles : priorité à C13, C9, C16, 125, T3 et métros A et D. Au plus deux fiches supplémentaires compatibles avec le GTFS par cycle ; aucune collecte exhaustive.</p>
    <div className="time-fields"><label className="field"><span>Rechercher une ligne</span><input maxLength={30} value={line} onChange={e => setLine(e.target.value)} placeholder="Ex. T3"/></label><label className="field"><span>Mode</span><select value={mode} onChange={e => setMode(e.target.value)}><option value="">Tous les modes</option><option value="bus">Bus et trolleybus</option><option value="tram">Tramway</option><option value="metro">Métro</option><option value="funicular">Funiculaire</option></select></label></div>
    <label className="field"><span>Date à examiner (Europe/Paris)</span><input type="date" value={date} onChange={e => setDate(e.target.value)}/></label><p className="search-hint">Les annonces dont la période reste incertaine sont conservées dans le filtre par prudence. Le statut « En cours » se rapporte à maintenant.</p>
    <button type="button" className="secondary" disabled={busy} onClick={() => setRefresh(n => n + 1)}>Actualiser via le cache serveur</button>
    {busy && <p role="status">Chargement des informations officielles TCL…</p>}{error && <p className="message error" role="alert">{error} Les informations précédentes éventuelles restent affichées, sans nouvelle vérification.</p>}
    {snapshot && <><TrafficFreshness snapshot={snapshot}/>{(busy || error) && <p className="message">Résultats de la consultation précédente ; les nouveaux filtres ne sont pas encore confirmés.</p>}
      <details className="traffic-coverage" open><summary>Couverture des lignes du catalogue GTFS</summary><p>{counts.verified} vérifiée(s) : {counts.withAnnouncements} avec annonces, {counts.withoutAnnouncements} sans annonce après consultation réussie. {counts.notChecked} non consultée(s), {counts.failed} en échec, {counts.stale} périmée(s).</p>
        <p className="search-hint">Dernière tentative globale : {when(snapshot.checkedAt)}. Les lectures du cache ne changent pas cette date. Recherchez un code pour examiner une autre ligne.</p>
        <ul>{visibleRows.slice(0,50).map(r => <li key={`${r.line}-${r.mode}`}><strong>{r.line}</strong> · {{ with_announcements: 'Consultée avec annonces', without_announcements: 'Consultée sans annonce', not_checked: 'Non consultée : état indéterminé', failed: 'Échec de collecte', stale: 'Données périmées' }[r.state]}<br/><small>Dernière tentative : {r.lastAttemptAt ? when(r.lastAttemptAt) : 'aucune'} · Dernier succès : {r.lastSuccessAt ? when(r.lastSuccessAt) : 'aucun'}</small>{r.error && <p className="message error">{r.error}</p>}{r.sourceUrl && <p><a href={r.sourceUrl} target="_blank" rel="noreferrer">Fiche officielle {r.line}</a></p>}</li>)}</ul>
      </details>
      {snapshot.state !== 'unavailable' && !snapshot.incidents.length && <p className="traffic-empty">Aucune perturbation connue dans les données consultées pour ces filtres. Cela ne signifie pas que le réseau est sans perturbation.</p>}
      {groups.map(([status, label]) => { const items = snapshot.incidents.filter(i => fresh(i) && temporalStatus(i, now) === status); return items.length ? <section key={status} className="traffic-group"><h3>{label} ({items.length})</h3>{items.map(i => <Incident key={i.id} incident={i}/>)}</section> : null })}
      {snapshot.incidents.some(i => !fresh(i)) && <section className="traffic-group"><h3>Données anciennes non reconfirmées</h3><p>Ces annonces sont conservées pour information ; leur présence actuelle n’est pas vérifiée.</p>{snapshot.incidents.filter(i => !fresh(i)).map(i => <Incident key={i.id} incident={i}/>)}</section>}
    </>}
    {!snapshot && !busy && <p>Données indisponibles. L’absence de données ne signifie pas l’absence de perturbation.</p>}
    <p className="search-hint"><a href="https://www.tcl.fr/se-deplacer/travaux-en-cours-sur-le-reseau-tcl" target="_blank" rel="noreferrer">Travaux officiels TCL</a> · Aucun itinéraire n’est supprimé sur la seule base d’une annonce générale.</p>
  </section>
}
