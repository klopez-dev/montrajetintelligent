import type { GrandLyonConfig } from './config.ts'
import { GRANDLYON_URL } from './config.ts'
import { parseProviderRow } from './mapping.ts'
import type { ProviderRow } from './mapping.ts'
import { providerInstant } from './time.ts'

export interface Snapshot { stopId: string; fetchedAt: number; rows: ProviderRow[] }
export interface SnapshotStore {
  get(stopId: string): Promise<Snapshot | null>
  put(snapshot: Snapshot): Promise<void>
}
export interface ProviderResult { snapshot: Snapshot | null; reason: string; checkedAt: number }
export interface GrandLyonClient { get(stopId: string): Promise<ProviderResult> }

function basic(username: string, password: string): string {
  return btoa(Array.from(new TextEncoder().encode(`${username}:${password}`), byte => String.fromCharCode(byte)).join(''))
}
async function readJson(response: Response): Promise<unknown> {
  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new Error('invalid_response')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('invalid_response')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > 2_000_000) throw new Error('oversized_response')
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
    catch { throw new Error('invalid_response') }
  } finally { await reader.cancel().catch(() => {}) }
}
function decode(value: unknown, stopId: string, fetchedAt: number): Snapshot {
  if (!value || typeof value !== 'object') throw new Error('invalid_response')
  const envelope = value as Record<string, unknown>
  if (!Array.isArray(envelope.values) || envelope.values.length > 1000 || !Number.isSafeInteger(envelope.nb_results) || envelope.nb_results !== envelope.values.length) throw new Error('incomplete_response')
  const rows = envelope.values.map(parseProviderRow)
  if (rows.some(row => !row || row.id !== stopId || providerInstant(row.last_update_fme) === null || providerInstant(row.heurepassage) === null)) throw new Error('invalid_response')
  return { stopId, fetchedAt, rows: rows as ProviderRow[] }
}
function latest(snapshot: Snapshot): number {
  return Math.max(0, ...snapshot.rows.map(row => providerInstant(row.last_update_fme) || 0))
}
function mergeMonotonic(previous: Snapshot | null, next: Snapshot): Snapshot {
  if (!previous) return next
  if (previous.rows.length && !next.rows.length) throw new Error('empty_update')
  if (next.rows.length && latest(next) < latest(previous)) throw new Error('regressed_data')
  const key = (row: ProviderRow) => JSON.stringify([row.id, row.ligne, row.coursetheorique, row.idtarretdestination])
  const oldRows = new Map(previous.rows.map(row => [key(row), row]))
  return { ...next, rows: next.rows.map(row => {
    const old = oldRows.get(key(row))
    return old && providerInstant(old.last_update_fme)! > providerInstant(row.last_update_fme)! ? old : row
  }) }
}

/** Client serveur paresseux : pas de polling, coalescence, mémoire bornée, délai
 * global entre tentatives, Retry-After, aucun contournement d'un 401/403.
 */
export function createGrandLyonClient(config: GrandLyonConfig, dependencies: { fetch?: typeof fetch; now?: () => number; store?: SnapshotStore; endpointForTest?: string } = {}): GrandLyonClient {
  const request = dependencies.fetch || fetch
  const now = dependencies.now || Date.now
  // Un endpoint alternatif n'est injecté que par les tests HTTP locaux, jamais par le navigateur/env.
  const endpoint = dependencies.endpointForTest || GRANDLYON_URL
  const cache = new Map<string, Snapshot>()
  const inFlight = new Map<string, Promise<ProviderResult>>()
  let nextAttempt = 0
  let denied = false
  let validationAttempted = false
  function remember(snapshot: Snapshot) {
    if (cache.size >= 128 && !cache.has(snapshot.stopId)) cache.delete(cache.keys().next().value!)
    cache.set(snapshot.stopId, snapshot)
  }
  async function cached(stopId: string) {
    let snapshot = cache.get(stopId) || null
    if (!snapshot && dependencies.store) {
      try {
        const stored = await dependencies.store.get(stopId)
        if (stored && stored.stopId === stopId && stored.fetchedAt <= now() && now() - stored.fetchedAt <= config.maxAgeMs) {
          // Revalider même un cache partagé : aucun cache n'est une preuve du contrat.
          snapshot = decode({ values: stored.rows, nb_results: stored.rows.length }, stopId, stored.fetchedAt)
          remember(snapshot)
        }
      } catch { /* Le cache partagé ne bloque pas le repli GTFS. */ }
    }
    return snapshot
  }
  return {
    async get(stopId) {
      const checkedAt = now()
      const result = (reason: string, snapshot: Snapshot | null = null): ProviderResult => ({ reason, snapshot, checkedAt: now() })
      if (!config.username || !config.password) return result('authentication_required')
      if (!config.policyConfirmed && !config.localValidationOnce) return result('policy_unconfirmed')
      if (!config.stopPassagesConfirmed && !config.localValidationOnce) return result('mapping_unconfirmed')
      if (denied) return result('access_denied', await cached(stopId))
      if (inFlight.has(stopId)) return inFlight.get(stopId)!
      const pending = (async () => {
        const snapshot = await cached(stopId)
        if (snapshot && checkedAt - snapshot.fetchedAt < config.cacheTtlMs) return result('cached', snapshot)
        if (config.localValidationOnce && validationAttempted) return result('validation_budget_exhausted', snapshot)
        if (now() < nextAttempt) return result('cooldown', snapshot)
        nextAttempt = now() + config.minIntervalMs
        if (config.localValidationOnce) validationAttempted = true
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), config.timeoutMs)
        try {
          const url = new URL(endpoint)
          url.search = new URLSearchParams({ id__eq: stopId, maxfeatures: '24' }).toString()
          const response = await request(url, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/json', Authorization: `Basic ${basic(config.username, config.password)}` } })
          if (response.status === 401 || response.status === 403) { denied = true; await response.body?.cancel(); return result('access_denied', snapshot) }
          if (response.status === 429 || response.status === 503) {
            const retry = response.headers.get('retry-after')
            if (retry) {
              const until = /^\d+$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry)
              if (Number.isFinite(until)) nextAttempt = Math.max(nextAttempt, until)
            }
          }
          if (!response.ok) { await response.body?.cancel(); return result(response.status === 429 ? 'rate_limited' : 'provider_unavailable', snapshot) }
          const next = mergeMonotonic(snapshot, decode(await readJson(response), stopId, now()))
          // Une date future dans la source n'est pas une preuve de fraîcheur.
          if (latest(next) > now() + 5000) return result('invalid_response', snapshot)
          remember(next)
          try { await dependencies.store?.put(next) } catch { /* Cache en mémoire conservé. */ }
          return result('fetched', next)
        } catch (error) {
          const reason = controller.signal.aborted ? 'timeout' : error instanceof Error && ['invalid_response', 'incomplete_response', 'regressed_data', 'oversized_response', 'empty_update'].includes(error.message) ? error.message : 'provider_unavailable'
          return result(reason, snapshot)
        } finally { clearTimeout(timer) }
      })()
      inFlight.set(stopId, pending)
      try { return await pending } finally { inFlight.delete(stopId) }
    },
  }
}
