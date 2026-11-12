import { DatabaseSync } from 'node:sqlite'
import { open, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const tables = ['metadata', 'agency', 'routes', 'stops', 'services', 'calendar_dates', 'trips', 'stop_times', 'route_stops', 'search_tokens', 'transfers']
function identifier(value) { return `"${value.replaceAll('"', '""')}"` }
function literal(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

/** Export SQL hors ligne pour une future base D1 VIDE. Aucun appel Cloudflare.
 * Chaque statement est court ; les fichiers ne sont jamais remplacés.
 */
export async function exportSql(databasePath, outputDirectory) {
  await mkdir(outputDirectory) // refus si le dossier existe déjà
  const db = new DatabaseSync(databasePath, { readOnly: true })
  let file
  let index = 0
  let lines = 0
  async function nextFile() {
    if (file) await file.close()
    file = await open(resolve(outputDirectory, `${String(index++).padStart(4, '0')}.sql`), 'wx')
    lines = 0
  }
  async function write(text) {
    if (!file || lines >= 10_000) await nextFile()
    await file.write(`${text}\n`)
    lines++
  }
  try {
    // Ordre explicite respectant les clés étrangères, sans BEGIN/COMMIT ni DROP.
    for (const table of tables) {
      const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)
      if (!schema) throw new Error(`Table absente : ${table}`)
      await write(`${schema.sql};`)
      const columns = db.prepare(`PRAGMA table_info(${identifier(table)})`).all().map(column => column.name)
      for (const row of db.prepare(`SELECT * FROM ${identifier(table)}`).iterate()) {
        await write(`INSERT INTO ${identifier(table)} VALUES(${columns.map(name => literal(row[name])).join(',')});`)
      }
    }
    for (const row of db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all()) await write(`${row.sql};`)
    return { files: index, directory: outputDirectory }
  } finally { if (file) await file.close(); db.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) {
    console.error('Usage : node scripts/gtfs/export-sql.mjs chemin/base.sqlite nouveau-dossier-export')
    process.exitCode = 1
  } else {
    try { console.log(await exportSql(resolve(process.argv[2]), resolve(process.argv[3]))) }
    catch (error) { console.error(error.message); process.exitCode = 1 }
  }
}
