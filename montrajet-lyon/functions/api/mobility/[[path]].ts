import { createMobilityApi } from '../../../server/mobility/api.ts'
import type { QueryDatabase } from '../../../server/gtfs/repository.ts'
import { routingLimits } from '../../../server/journeys/limits.ts'

interface Binding { prepare(sql: string): { bind(...values: (string | number | null)[]): { all<T>(): Promise<{ results: T[] }> } } }
const adapters = new WeakMap<Binding, QueryDatabase>()
const api = createMobilityApi()
const handlers = new WeakMap<Binding, ReturnType<typeof createMobilityApi>>()
export async function onRequest(context: { request: Request; env: { GTFS_DB?: Binding; [name: string]: unknown } }) {
  const binding = context.env.GTFS_DB
  if (!binding) return api(context.request, null)
  let db = adapters.get(binding)
  if (!db) { db = { all: async <T>(sql: string, params: (string | number | null)[] = []) => (await binding.prepare(sql).bind(...params).all<T>()).results }; adapters.set(binding, db) }
  try {
    let handler = handlers.get(binding)
    if (!handler) { handler = createMobilityApi(undefined, routingLimits(context.env)); handlers.set(binding, handler) }
    return handler(context.request, db)
  } catch { return Response.json({ error: 'Configuration des budgets de calcul invalide.' }, { status: 503 }) }
}
