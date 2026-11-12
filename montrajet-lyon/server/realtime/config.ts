export const GRANDLYON_URL = 'https://data.grandlyon.com/fr/datapusher/ws/rdata/tcl_sytral.tclpassagearret/all.json'

export interface GrandLyonConfig {
  username: string
  password: string
  policyConfirmed: boolean
  mappingConfirmed: boolean
  stopPassagesConfirmed: boolean
  /** Uniquement injecté par le plugin Vite local ; jamais par l'environnement Edge. */
  localValidationOnce: boolean
  /** Choix techniques, pas des quotas annoncés par le fournisseur. */
  minIntervalMs: number
  cacheTtlMs: number
  maxAgeMs: number
  timeoutMs: number
}

function bounded(value: string | undefined, fallback: number, min: number, max: number) {
  if (!value) return fallback
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error('Configuration Grand Lyon invalide.')
  return n
}

/** Uniquement des variables serveur, jamais VITE_*. L'absence de preuve bloque l'activation. */
export function grandLyonConfig(env: Record<string, string | undefined>): GrandLyonConfig {
  const minIntervalMs = bounded(env.GRANDLYON_MIN_INTERVAL_MS, 60000, 10000, 3600000)
  return {
    username: env.GRANDLYON_USERNAME || '', password: env.GRANDLYON_PASSWORD || '',
    policyConfirmed: env.GRANDLYON_POLICY_CONFIRMED === 'true',
    mappingConfirmed: env.GRANDLYON_MAPPING_CONFIRMED === 'true',
    stopPassagesConfirmed: env.GRANDLYON_STOP_PASSAGES_CONFIRMED === 'true',
    localValidationOnce: false,
    minIntervalMs,
    cacheTtlMs: Math.max(minIntervalMs, bounded(env.GRANDLYON_CACHE_TTL_MS, 60000, 10000, 3600000)),
    maxAgeMs: bounded(env.GRANDLYON_MAX_AGE_MS, 120000, 1000, 300000),
    timeoutMs: bounded(env.GRANDLYON_TIMEOUT_MS, 5000, 100, 15000),
  }
}
