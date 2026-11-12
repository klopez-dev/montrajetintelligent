import { handleJourneyRequest } from '../../../server/journeys/api.ts'
import type { QueryDatabase } from '../../../server/gtfs/repository.ts'
import { routingLimits } from '../../../server/journeys/limits.ts'

interface D1Binding {
  prepare(sql: string): { bind(...args: (string | number | null)[]): { all<T>(): Promise<{ results: T[] }> } }
}
const adapters = new WeakMap<D1Binding, QueryDatabase>()
export async function onRequest(context: { request: Request; env: { GTFS_DB?: D1Binding; [name: string]: unknown } }) {
  const binding = context.env.GTFS_DB
  if (!binding) return handleJourneyRequest(context.request, null)
  let db = adapters.get(binding)
  if (!db) {
    db = { all: async <T>(sql: string, params: (string | number | null)[] = []) => (await binding.prepare(sql).bind(...params).all<T>()).results }
    adapters.set(binding, db)
  }
  try { return handleJourneyRequest(context.request, db, routingLimits(context.env)) }
  catch { return Response.json({ error: 'Configuration des budgets de calcul invalide.' }, { status: 503 }) }
}
