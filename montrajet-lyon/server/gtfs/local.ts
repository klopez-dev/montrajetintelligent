import { createLocalTrafficProvider } from '../traffic/localCache.ts'
import { createTrafficApi } from '../traffic/api.ts'
import type { ServerResponse } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync } from 'node:fs'
import { handleMapRequest } from '../maps/api.ts'
import type { MapCatalog } from '../maps/api.ts'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, ViteDevServer } from 'vite'
import { loadEnv } from 'vite'
import { handleGtfsRequest } from './api.ts'
import type { QueryDatabase } from './repository.ts'
import { createGrandLyonClient } from '../realtime/client.ts'
import { grandLyonConfig } from '../realtime/config.ts'
import { loadLocalCredential, serverCredential } from '../realtime/credentials.ts'
import { handleRealtimeRequest } from '../realtime/api.ts'
import { handleJourneyRequest } from '../journeys/api.ts'
import { createMobilityApi } from '../mobility/api.ts'
import { defaultRoutingLimits, routingLimits } from '../journeys/limits.ts'

/** Forward chunks immediately; buffering response.text() would hide all real progress. */
async function sendResponse(response: Response, res: ServerResponse) {
  res.statusCode = response.status
  response.headers.forEach((value, name) => res.setHeader(name, value))
  if (!response.body) { res.end(); return }
  const reader = response.body.getReader()
  const close = () => { void reader.cancel().catch(() => {}) }
  res.once('close', close)
  try {
    res.flushHeaders()
    while (!res.destroyed) {
      const { done, value } = await reader.read()
      if (done) break
      if (!res.write(value)) await new Promise<void>(resolve => {
        const finish = () => { res.removeListener('drain', finish); res.removeListener('close', finish); resolve() }
        res.once('drain', finish); res.once('close', finish)
      })
    }
    if (!res.destroyed) res.end()
  } finally { res.removeListener('close', close); await reader.cancel().catch(() => {}); reader.releaseLock() }
}

export function localGtfsPlugin(): Plugin {
  const trafficApi = createTrafficApi(createLocalTrafficProvider(fileURLToPath(new URL('../../.data/traffic-official-cache-v1.json', import.meta.url))))
  let mobilityApi = createMobilityApi()
  let limits = defaultRoutingLimits
  let routingError = false
  let database: DatabaseSync | undefined
  let openedPath = ''
  let databaseAdapter: QueryDatabase | null = null
  let rtConfig = grandLyonConfig({})
  let rtClient = createGrandLyonClient(rtConfig)
  function getDatabase(): QueryDatabase | null {
    const path = process.env.GTFS_DB || fileURLToPath(new URL('../../.data/gtfs.sqlite', import.meta.url))
    if (!existsSync(path)) return null
    if (!database || openedPath !== path) {
      database?.close()
      database = new DatabaseSync(resolve(path), { readOnly: true })
      openedPath = path
      databaseAdapter = { all: async <T>(sql: string, params: (string | number | null)[] = []) => database!.prepare(sql).all(...params) as T[] }
    }
    return databaseAdapter
  }
  function setup(server: Pick<ViteDevServer, 'middlewares' | 'httpServer'>) {
    let mapCatalog: MapCatalog | null = null
    try { mapCatalog = JSON.parse(readFileSync(fileURLToPath(new URL('../../.data/map-catalog.json', import.meta.url)), 'utf8')) } catch { /* Missing optional colors use a labelled fallback. */ }
    server.middlewares.use('/api/maps', async (req, res) => {
      try {
        const chunks: Buffer[] = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 12000) { res.statusCode = 413; res.end(); return }; chunks.push(Buffer.from(chunk)) }
        const response = await handleMapRequest(new Request('http://localhost/api/maps', { method: req.method, ...(req.method === 'POST' ? { body: Buffer.concat(chunks).toString('utf8') } : {}) }), getDatabase(), mapCatalog)
        await sendResponse(response, res)
      } catch { res.statusCode = 503; res.end(JSON.stringify({ error: 'Carte indisponible. Les résultats textuels restent utilisables.' })) }
    })
    server.middlewares.use('/api/traffic', async (req, res) => {
      try {
        const chunks: Buffer[] = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 32000) { res.statusCode = 413; res.end(JSON.stringify({ error: 'Requête trafic trop volumineuse.' })); return }; chunks.push(Buffer.from(chunk)) }
        const response = await trafficApi(new Request(`http://localhost/api/traffic${(req.url || '').replace(/^\/(?=\?|$)/, '')}`, { method: req.method, ...(req.method === 'POST' ? { body: Buffer.concat(chunks).toString('utf8') } : {}) }), getDatabase())
        await sendResponse(response, res)
      } catch { if (res.headersSent || res.destroyed) { res.destroy(); return }; res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Trafic TCL indisponible.' })) }
    })
    server.middlewares.use('/api/mobility', async (req, res) => {
      try {
        if (routingError) { res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Configuration des budgets de calcul invalide.' })); return }
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk)
          size += bytes.length
          if (size > 4096) { res.statusCode = 413; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Recherche trop volumineuse.' })); return }
          chunks.push(bytes)
        }
        const controller = new AbortController()
        res.once('close', () => { if (!res.writableEnded) controller.abort() })
        const response = await mobilityApi(new Request(`http://localhost/api/mobility${req.url || '/'}`, { method: req.method, headers: { Accept: req.headers.accept || 'application/json' }, signal: controller.signal, ...(req.method === 'POST' ? { body: Buffer.concat(chunks).toString('utf8') } : {}) }), getDatabase())
        await sendResponse(response, res)
      } catch { if (res.headersSent || res.destroyed) { res.destroy(); return }; res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Service adresses et marche indisponible.' })) }
    })
    server.middlewares.use('/api/journeys', async (req, res) => {
      try {
        if (routingError && req.url?.startsWith('/search')) { res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Configuration des budgets de calcul invalide.' })); return }
        const controller = new AbortController()
        res.once('close', () => { if (!res.writableEnded) controller.abort() })
        const response = await handleJourneyRequest(new Request(`http://localhost/api/journeys${req.url || '/'}`, { method: req.method, headers: { Accept: req.headers.accept || 'application/json' }, signal: controller.signal }), getDatabase(), limits)
        await sendResponse(response, res)
      } catch { if (res.headersSent || res.destroyed) { res.destroy(); return }; res.statusCode = 503; res.end(JSON.stringify({ error: 'Calculateur GTFS indisponible.' })) }
    })
    server.middlewares.use('/api/realtime', async (req, res) => {
      try {
        if (rtConfig.localValidationOnce && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) {
          res.statusCode = 403
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Validation locale réservée à la boucle locale.' }))
          return
        }
        const request = new Request(`http://localhost/api/realtime${req.url || '/'}`, { method: req.method })
        const response = await handleRealtimeRequest(request, getDatabase(), rtClient, rtConfig.maxAgeMs, rtConfig)
        res.statusCode = response.status
        response.headers.forEach((value, name) => res.setHeader(name, value))
        res.end(await response.text())
      } catch {
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'Temps réel indisponible. Les horaires théoriques restent disponibles.' }))
      }
    })
    server.middlewares.use('/api/gtfs', async (req, res) => {
      try {
        const request = new Request(`http://localhost/api/gtfs${req.url || '/'}`, { method: req.method })
        const response = await handleGtfsRequest(request, getDatabase())
        res.statusCode = response.status
        response.headers.forEach((value, name) => res.setHeader(name, value))
        res.end(await response.text())
      } catch (error) {
        console.error('Base GTFS locale inaccessible', error)
        res.statusCode = 503
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ status: 'disconnected', message: 'Base GTFS locale inaccessible. Vérifiez GTFS_DB et le rapport d’import.' }))
      }
    })
    server.httpServer?.once('close', () => { database?.close(); database = undefined })
  }
  return {
    name: 'local-gtfs-api',
    configResolved(config) {
      try { limits = routingLimits(loadEnv(config.mode, config.envDir, 'ROUTING_')); mobilityApi = createMobilityApi(undefined, limits) }
      catch { routingError = true }
      try {
        const variables = loadEnv(config.mode, config.envDir, 'GRANDLYON_')
        const credential = serverCredential(variables, loadLocalCredential())
        rtConfig = { ...grandLyonConfig({ ...variables, GRANDLYON_USERNAME: credential?.username, GRANDLYON_PASSWORD: credential?.password }),
          localValidationOnce: process.env.MONTRAJET_REALTIME_VALIDATE_ONCE === '1' }
        rtClient = createGrandLyonClient(rtConfig)
      } catch {
        // Une configuration temps réel erronée ne doit pas bloquer Vite et le GTFS.
        rtConfig = grandLyonConfig({})
        rtClient = { get: async () => ({ snapshot: null, reason: 'configuration_invalid', checkedAt: Date.now() }) }
      }
    },
    configureServer: setup, configurePreviewServer: setup,
  }
}
