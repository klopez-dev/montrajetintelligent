import { readFileSync, existsSync } from 'node:fs'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { TrafficSnapshot } from '../../src/types/traffic.ts'
import { createTrafficProvider, trafficSource } from './provider.ts'
import { officialUrl } from './html.ts'

const marker = 'montrajet-official-traffic-cache-v1'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
/** Node adapter only: no fs in the Web/Cloudflare provider. Never refreshes timestamps on read. */
export function readTrafficCache(path: string): TrafficSnapshot | undefined {
  try {
    const raw = readFileSync(path, 'utf8'); if (raw.length > 2500000) return
    const entry = JSON.parse(raw), data = entry.data as TrafficSnapshot
    if (entry.marker !== marker || entry.sha256 !== hash(JSON.stringify(data)) || data.sourceUrl !== trafficSource || !data.fetchedAt || !data.validUntil || !Number.isFinite(Date.parse(data.fetchedAt)) || !Number.isFinite(Date.parse(data.validUntil)) || Date.parse(data.fetchedAt) > Date.now() + 5000 || Date.parse(data.validUntil) > Date.parse(data.fetchedAt) + 600000 || !Array.isArray(data.incidents) || data.incidents.length > 700 || !Array.isArray(data.coverage) || data.coverage.some(l => !/^[A-Za-z0-9]{1,30}$/.test(l))) return
    for (const incident of data.incidents) {
      officialUrl(incident.sourceUrl)
      if (!/^tcl-html:[a-f0-9]{64}$/.test(incident.id) || typeof incident.description !== 'string' || incident.description.length > 30000 || !Array.isArray(incident.lines) || !Array.isArray(incident.periods) || incident.relatedUrls.some(url => { officialUrl(url); return false })) return
    }
    return data
  } catch { return undefined }
}
export async function writeTrafficCache(path: string, data: TrafficSnapshot) {
  if (existsSync(path) && !readTrafficCache(path)) return // Unknown/user file: do not overwrite.
  await mkdir(dirname(path), { recursive: true })
  const temporary = path + '.' + randomUUID() + '.tmp'
  await writeFile(temporary, JSON.stringify({ marker, sha256: hash(JSON.stringify(data)), data }), { flag: 'wx' })
  await rename(temporary, path)
}
export function createLocalTrafficProvider(path: string) {
  return createTrafficProvider(undefined, undefined, undefined, { initial: readTrafficCache(path), save: data => writeTrafficCache(path, data) })
}
