import { createTrafficApi } from '../../../server/traffic/api.ts'
import type { QueryDatabase } from '../../../server/gtfs/repository.ts'

interface Binding { prepare(sql: string): { bind(...params: (string | number | null)[]): { all<T>(): Promise<{ results: T[] }> } } }
const api = createTrafficApi(), adapters = new WeakMap<Binding, QueryDatabase>()
export async function onRequest(context: { request: Request; env: { GTFS_DB?: Binding } }) {
  const binding = context.env.GTFS_DB
  if (!binding) return api(context.request, null)
  let db = adapters.get(binding)
  if (!db) { db = { all: async <T>(sql: string, params: (string | number | null)[] = []) => (await binding.prepare(sql).bind(...params).all<T>()).results }; adapters.set(binding, db) }
  return api(context.request, db)
}
