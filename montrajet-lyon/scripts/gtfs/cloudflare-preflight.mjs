import { DatabaseSync } from 'node:sqlite'
import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Read-only local assessment for moving an existing GTFS SQLite database to D1.
 * Never uploads the feed, writes a file, changes the active DB or creates a Cloudflare resource.
 */
const databasePath = resolve(process.argv[2] || '.data/gtfs.sqlite')
if (!existsSync(databasePath)) {
  console.error('Base locale absente : ' + databasePath)
  process.exitCode = 1
} else {
  let db
  try {
    db = new DatabaseSync(databasePath, { readOnly: true })
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name)
    const required = ['metadata', 'routes', 'stops', 'services', 'calendar_dates', 'trips', 'stop_times', 'route_stops', 'search_tokens', 'transfers']
    const missing = required.filter(name => !tables.includes(name))
    if (missing.length) throw new Error('Schéma GTFS incomplet : ' + missing.join(', '))

    const counts = Object.fromEntries(tables.map(name => {
      const safe = '"' + name.replaceAll('"', '""') + '"'
      return [name, Number(db.prepare('SELECT count(*) AS count FROM ' + safe).get().count)]
    }))
    const metadataRow = db.prepare('SELECT json FROM metadata WHERE id=1').get()
    if (!metadataRow) throw new Error('Métadonnées GTFS absentes')
    const metadata = JSON.parse(metadataRow.json)
    const pageSize = Number(db.prepare('PRAGMA page_size').get().page_size)
    const pageCount = Number(db.prepare('PRAGMA page_count').get().page_count)
    const bytes = statSync(databasePath).size
    let storageBreakdown
    try {
      storageBreakdown = db.prepare("SELECT name, sum(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC").all().slice(0, 16)
    } catch {
      storageBreakdown = 'non disponible (extension SQLite dbstat absente)'
    }
    const freeDailyWrites = 100000
    const rows = Object.values(counts).reduce((a, b) => a + b, 0)
    const report = {
      mode: 'lecture-seule, aucun import et aucun déploiement',
      databasePath,
      localSizeMiB: Number((bytes / 1048576).toFixed(2)),
      sqlitePages: pageCount,
      sqlitePageSize: pageSize,
      estimatedDbPagesMiB: Number((pageCount * pageSize / 1048576).toFixed(2)),
      feed: {
        schemaVersion: metadata.schemaVersion,
        validFrom: metadata.validFrom,
        validUntil: metadata.validUntil,
        timezone: metadata.timezone,
        sha256: metadata.sha256
      },
      rowsByTable: counts,
      totalRows: rows,
      largestObjects: storageBreakdown,
      cloudflareFree: {
        maxDatabaseBytes: 500000000,
        sizeAlreadyAboveLimit: bytes > 500000000,
        dailyWrittenRowsAllowance: freeDailyWrites,
        optimisticMinimumDaysAtQuota: Math.ceil(rows / freeDailyWrites),
        caveat: 'Le temps et la taille réels peuvent dépasser cette estimation à cause des index, de la structure D1 et des écritures supplémentaires.'
      },
      recommendation: bytes > 450000000
        ? 'Risque fort de saturation : réduire le dataset AVANT de créer/importer une base.'
        : 'Ne pas importer directement : mesurer les index et préparer un dataset réduit ou un chargement contrôlé avant D1.'
    }
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    console.error('Préflight GTFS : ' + (error instanceof Error ? error.message : String(error)))
    process.exitCode = 1
  } finally {
    db?.close()
  }
}
