import type { Snapshot, SnapshotStore } from './client.ts'

export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}
/** Cache serveur Cloudflare par centre de données ; aucune donnée source dans les assets.
 * La coordination globale des quotas devra être confirmée avant tout déploiement.
 */
export function edgeSnapshotStore(cache: EdgeCache, ttlMs: number): SnapshotStore {
  const key = (stopId: string) => new Request(`https://montrajet-cache.invalid/grandlyon/v1/${encodeURIComponent(stopId)}`)
  return {
    async get(stopId) {
      const response = await cache.match(key(stopId))
      return response ? await response.json() as Snapshot : null
    },
    async put(snapshot) {
      await cache.put(key(snapshot.stopId), new Response(JSON.stringify(snapshot), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${Math.ceil(ttlMs / 1000)}` } }))
    },
  }
}
