import { handleGtfsRequest } from '../../../server/gtfs/api.ts'

// Interfaces minimales structurelles : aucune dépendance au runtime Node côté Cloudflare.
interface D1Binding {
  prepare(sql: string): { bind(...args: (string | number | null)[]): { all<T>(): Promise<{ results: T[] }> } }
}
export async function onRequest(context: { request: Request; env: { GTFS_DB?: D1Binding } }) {
  const binding = context.env.GTFS_DB
  return handleGtfsRequest(context.request, binding ? {
    all: async <T>(sql: string, params: (string | number | null)[] = []) => (await binding.prepare(sql).bind(...params).all<T>()).results,
  } : null)
}
