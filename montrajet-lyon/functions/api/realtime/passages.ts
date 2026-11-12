import { handleRealtimeRequest } from '../../../server/realtime/api.ts'
import { createGrandLyonClient } from '../../../server/realtime/client.ts'
import type { GrandLyonClient } from '../../../server/realtime/client.ts'
import { grandLyonConfig } from '../../../server/realtime/config.ts'
import { edgeSnapshotStore } from '../../../server/realtime/edge-cache.ts'
import type { EdgeCache } from '../../../server/realtime/edge-cache.ts'

interface D1Binding {
  prepare(sql: string): { bind(...args: (string | number | null)[]): { all<T>(): Promise<{ results: T[] }> } }
}
let cachedClient: GrandLyonClient | undefined
let previousConfiguration = ''
export async function onRequest(context: { request: Request; env: Record<string, unknown> & { GTFS_DB?: D1Binding } }) {
  const environment = Object.fromEntries(Object.entries(context.env).filter(([key, value]) => key.startsWith('GRANDLYON_') && typeof value === 'string')) as Record<string, string>
  let config
  try { config = grandLyonConfig(environment) }
  catch { return new Response(JSON.stringify({ error: 'Configuration serveur du temps réel invalide.' }), { status: 503, headers: { 'Content-Type': 'application/json' } }) }
  // Conservé seulement en mémoire de l'isolate, jamais journalisé ou renvoyé au navigateur.
  const signature = JSON.stringify(config)
  if (!cachedClient || signature !== previousConfiguration) {
    const cache = (globalThis as unknown as { caches?: { default?: EdgeCache } }).caches?.default
    cachedClient = createGrandLyonClient(config, { store: cache ? edgeSnapshotStore(cache, config.maxAgeMs) : undefined })
    previousConfiguration = signature
  }
  const binding = context.env.GTFS_DB
  return handleRealtimeRequest(context.request, binding ? {
    all: async <T>(sql: string, params: (string | number | null)[] = []) => (await binding.prepare(sql).bind(...params).all<T>()).results,
  } : null, cachedClient, config.maxAgeMs)
}
