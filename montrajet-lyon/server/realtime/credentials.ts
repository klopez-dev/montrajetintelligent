import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export interface ServerCredential { username: string; password: string }
// Vite regroupe vite.config.ts dans .vite-temp : import.meta.url peut alors
// désigner ce bundle. Le second chemin reste dans le projet, jamais dans dist.
const directScript = fileURLToPath(new URL('../../scripts/realtime/credential-store.ps1', import.meta.url))
const script = existsSync(directScript) ? directScript : resolve(process.cwd(), 'scripts/realtime/credential-store.ps1')
const directStore = resolve(fileURLToPath(new URL('../../.data/', import.meta.url)), 'realtime-credential.clixml')
const store = existsSync(directScript) ? directStore : resolve(process.cwd(), '.data/realtime-credential.clixml')

/** Windows DPAPI CurrentUser via Export-Clixml. Never log process stdout or errors. */
export function loadLocalCredential(storePath = store): ServerCredential | null {
  if (process.platform !== 'win32') return null
  try {
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'Read', '-StorePath', storePath], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim()
    if (raw === 'missing' || raw === 'unavailable') return null
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const row = value as Record<string, unknown>
    return typeof row.username === 'string' && row.username.length > 0 && typeof row.password === 'string' && row.password.length > 0 ? { username: row.username, password: row.password } : null
  } catch { return null }
}

export function serverCredential(env: Record<string, string | undefined>, local: ServerCredential | null): ServerCredential | null {
  if (env.GRANDLYON_USERNAME && env.GRANDLYON_PASSWORD) return { username: env.GRANDLYON_USERNAME, password: env.GRANDLYON_PASSWORD }
  return local
}
