import { coverageAt } from '../../src/services/trafficCoverage.ts'
import type { TrafficIncident, TrafficSnapshot, TrafficCoverage, TrafficMode } from '../../src/types/traffic.ts'
import { clean, find, discoverLinePages, parseLine, priorities } from './html.ts'
import { parse } from 'parse5'

export const trafficSource = 'https://www.tcl.fr/infos-trafic'
export interface TrafficProvider { get(catalogue?: { line: string; mode: TrafficMode }[]): Promise<TrafficSnapshot> }
export function createTrafficProvider(fetcher: typeof fetch = fetch, now = () => Date.now(), pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)), persistence?: { initial?: TrafficSnapshot; save: (snapshot: TrafficSnapshot) => Promise<void> }) : TrafficProvider {
  let snapshot: TrafficSnapshot | undefined = persistence?.initial, pending: Promise<TrafficSnapshot> | undefined, nextAttempt = 0, policyUntil = 0, lastError: string | undefined
  let policyCheckedAt = snapshot?.policyCheckedAt
  if (policyCheckedAt && Number.isFinite(Date.parse(policyCheckedAt)) && Date.parse(policyCheckedAt) <= now()) policyUntil = Date.parse(policyCheckedAt) + 86400000
  let totalUpstreamRequests = 0
  const ttl = 600000
  let lastCheckedAt = snapshot?.checkedAt
  const previousRows = () => snapshot?.lineCoverage || priorities.map(p => ({ ...p, state: snapshot?.coverage.includes(p.line) ? 'with_announcements' as const : 'not_checked' as const, lastSuccessAt: snapshot?.coverage.includes(p.line) ? snapshot.fetchedAt : undefined, validUntil: snapshot?.coverage.includes(p.line) ? snapshot.validUntil : undefined }))
  return { async get(catalogue) {
    const started = performance.now(), time = now()
    const cached = (): TrafficSnapshot => ({ state: snapshot && coverageAt(previousRows(), now()).some(r => ['with_announcements','without_announcements'].includes(r.state)) ? 'available' : previousRows().some(r => r.lastSuccessAt) ? 'stale' : 'unavailable', partial: true, incidents: snapshot?.incidents || [], fetchedAt: snapshot?.fetchedAt, validUntil: snapshot?.validUntil, checkedAt: lastCheckedAt || new Date(time).toISOString(), lineCoverage: coverageAt(previousRows(), now()), discoveredLines: snapshot?.discoveredLines, policyCheckedAt, sourceUrl: trafficSource, coverage: snapshot?.coverage || [], error: lastError, metrics: { upstreamRequests: 0, totalUpstreamRequests, cacheHit: true, durationMs: performance.now() - started } })
    if (pending) { await pending; return cached() }
    if (snapshot && time < Date.parse(snapshot.validUntil!) || time < nextAttempt) return cached()
    nextAttempt = time + ttl
    pending = (async () => {
      let calls = 0
      lastCheckedAt = new Date(now()).toISOString()
      const records = new Map<string, TrafficCoverage>(previousRows().map(r => [r.line, { ...r }]))
      let blocked = false
      const signal = AbortSignal.timeout(45000)
      async function load(url: string) {
        if (calls) await pause(1000)
        signal.throwIfAborted(); calls++; totalUpstreamRequests++
        const response = await fetcher(url, { headers: { Accept: 'text/html, text/plain', 'User-Agent': 'MonTrajetLyon/0.1 (non-commercial traffic reader)' }, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) })
        if (response.status === 429 || response.status === 503) {
          blocked = true
          const retry = response.headers.get('Retry-After')
          const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Date.parse(retry) - now() : ttl
          nextAttempt = Math.max(nextAttempt, now() + (Number.isFinite(delay) ? Math.max(ttl, delay) : ttl))
        }
        if (!response.ok) { await response.body?.cancel(); throw new Error(`Source TCL indisponible (HTTP ${response.status}).`) }
        if (!/text\/(html|plain)/i.test(response.headers.get('Content-Type') || '')) { await response.body?.cancel(); throw new Error('Format de réponse TCL inattendu.') }
        const reader = response.body?.getReader(); if (!reader) throw new Error('Réponse TCL vide.')
        const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '', size = 0
        try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 1500000) throw new Error('Réponse TCL trop volumineuse.'); text += decoder.decode(value, { stream: true }) }; text += decoder.decode() }
        finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        return text
      }
      try {
        if (now() >= policyUntil) {
          const robots = await load('https://www.tcl.fr/robots.txt')
          const paths = ['/infos-trafic', '/mentions-legales', '/se-deplacer/infos-trafic-accessibilite/trafic/']
          const denied = [...robots.matchAll(/^Disallow:\s*(\S+)\s*$/gmi)].map(m => m[1])
          if (!robots.includes('User-agent:') || denied.some(rule => paths.some(path => path.startsWith(rule.replace(/\*.*$/, ''))))) throw new Error('Collecte TCL suspendue : restrictions robots à vérifier.')
          const legal = await load('https://www.tcl.fr/mentions-legales')
          const paragraphs = find(parse(legal), node => node.nodeName === 'p')
          // No script execution or hidden API; fail closed if the public permission changes.
          const permitted = paragraphs.some(node => {
            const raw = clean(node)
            return raw.includes('pas soumise à autorisation préalable') && raw.includes('commerciales et publicitaires')
          })
          if (!permitted) throw new Error('Collecte TCL suspendue : conditions de réutilisation modifiées.')
          policyCheckedAt = new Date(now()).toISOString()
          policyUntil = now() + 86400000
        }
        const pages = discoverLinePages(await load(trafficSource))
        const eligible = new Set((catalogue || []).map(p => p.line + ':' + p.mode))
        const additional = [...pages.values()].filter(p => !priorities.some(q => q.line === p.line) && eligible.has(p.line + ':' + p.mode)).sort((a, b) => (records.get(a.line)?.lastSuccessAt || '').localeCompare(records.get(b.line)?.lastSuccessAt || '') || a.line.localeCompare(b.line)).slice(0, 2)
        const selected = [...priorities, ...additional]
        const perLine = new Map<string, TrafficIncident[]>()
        for (const old of snapshot?.incidents || []) for (const ref of old.lines) {
          const items = perLine.get(ref.label) || []; items.push({ ...old, lines: [ref] }); perLine.set(ref.label, items)
        }
        for (const priority of selected) {
          const page = pages.get(priority.line)
          const previous = records.get(priority.line)
          if (!page || page.mode !== priority.mode || blocked || signal.aborted) continue
          const attemptedAt = new Date(now()).toISOString()
          try {
            const html = await load(page.url), successAt = new Date(now()).toISOString()
            const items = await parseLine(html, page.url, priority.line, page.mode, successAt)
            if (page.announcedCount !== undefined && items.length !== page.announcedCount) throw new Error('Fiche TCL incohérente avec le nombre d’annonces de l’index : structure modifiée ou mise à jour concurrente.')
            perLine.set(priority.line, items)
            records.set(priority.line, { line: priority.line, mode: page.mode, state: items.length ? 'with_announcements' : 'without_announcements', sourceUrl: page.url, lastAttemptAt: attemptedAt, lastSuccessAt: successAt, validUntil: new Date(Date.parse(successAt) + ttl).toISOString(), announcementCount: items.length })
          } catch (error) {
            records.set(priority.line, { ...previous, line: priority.line, mode: page.mode, sourceUrl: page.url, lastAttemptAt: attemptedAt, state: previous?.lastSuccessAt ? 'stale' : 'failed', error: error instanceof Error && /TCL/.test(error.message) ? error.message : 'Fiche TCL inaccessible ou délai dépassé.' })
          }
        }
        const incidents = new Map<string, TrafficIncident>()
        for (const items of perLine.values()) for (const item of items) {
          const prior = incidents.get(item.id)
          if (prior) { for (const ref of item.lines) if (!prior.lines.some(r => r.label === ref.label)) prior.lines.push(ref) }
          else incidents.set(item.id, { ...item, lines: [...item.lines] })
        }
        const rows = coverageAt([...records.values()], now()), fresh = rows.filter(r => ['with_announcements', 'without_announcements'].includes(r.state))
        const fetchedAt = rows.map(r => r.lastSuccessAt).filter((v): v is string => !!v).sort().at(-1)
        const validUntil = rows.map(r => r.validUntil).filter((v): v is string => !!v).sort().at(-1)
        lastError = rows.some(r => r.error) ? 'Collecte TCL partielle : certaines fiches ont échoué ; consulter leur statut.' : undefined
        snapshot = { state: fresh.length ? 'available' : incidents.size ? 'stale' : rows.some(r => r.state === 'without_announcements') ? 'available' : 'unavailable', partial: true, incidents: [...incidents.values()], coverage: fresh.map(r => r.line), lineCoverage: rows, discoveredLines: [...pages.values()], fetchedAt, checkedAt: lastCheckedAt!, policyCheckedAt, validUntil, sourceUrl: trafficSource, error: lastError, metrics: { upstreamRequests: calls, totalUpstreamRequests, cacheHit: false, durationMs: performance.now() - started } }
        if (snapshot.fetchedAt && snapshot.validUntil) await persistence?.save(snapshot).catch(() => {}) // Never persist an unverified empty failure as a valid snapshot.
        return snapshot
      } catch (error) {
        lastError = error instanceof Error && /TCL/.test(error.message) ? error.message : 'Source TCL inaccessible ou réponse invalide. Aucun incident inventé.'
        snapshot = { ...cached(), lineCoverage: [...records.values()].map(r => ({ ...r, state: r.lastSuccessAt ? 'stale' : r.state, error: r.error || lastError })) }
        return { ...cached(), error: lastError, metrics: { upstreamRequests: calls, totalUpstreamRequests, cacheHit: false, durationMs: performance.now() - started } }
      }
    })()
    try { return await pending } finally { pending = undefined }
  } }
}
