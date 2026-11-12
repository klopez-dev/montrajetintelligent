import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile, stat, copyFile, constants } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openZip } from './zip.mjs'
import { csvObjects } from './csv.mjs'
import { normalizeSearch, parseGtfsDate, parseGtfsTime } from '../../server/gtfs/time.ts'

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
export const defaultArchive = resolve(projectRoot, 'data/gtfs/GTFS_TCL.ZIP')
const defaultSource = 'https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP'
const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const specs = {
  'agency.txt': ['agency_name', 'agency_url', 'agency_timezone'],
  'routes.txt': ['route_id', 'route_type'],
  'stops.txt': ['stop_id', 'stop_name'],
  'trips.txt': ['route_id', 'service_id', 'trip_id'],
  'stop_times.txt': ['trip_id', 'stop_id', 'stop_sequence'],
  'calendar.txt': ['service_id', ...weekdays, 'start_date', 'end_date'],
  'calendar_dates.txt': ['service_id', 'date', 'exception_type'],
  'transfers.txt': ['transfer_type'],
  'feed_info.txt': ['feed_publisher_name', 'feed_publisher_url', 'feed_lang'],
}
function required(row, key) {
  if (!row[key]) throw new Error(`Valeur obligatoire absente : ${key}`)
  return row[key]
}
function integer(value, name, allowed) {
  if (!/^\d+$/.test(value ?? '')) throw new Error(`Entier invalide (${name}) : ${value}`)
  const number = Number(value)
  if (!Number.isSafeInteger(number) || (allowed && !allowed.includes(number))) throw new Error(`Valeur invalide (${name}) : ${value}`)
  return number
}
function coordinate(value, max) {
  if (!value) return null
  const n = Number(value)
  if (!Number.isFinite(n) || Math.abs(n) > max) throw new Error(`Coordonnée invalide : ${value}`)
  return n
}
async function exists(path) {
  try { await stat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

/** Import transactionnel vers un NOUVEAU répertoire. Le jeu actif n'est jamais remplacé. */
export async function importGtfs({ archive = defaultArchive, sourceUrl = defaultSource, outputRoot = resolve(projectRoot, '.data') } = {}) {
  if (!await exists(archive)) throw new Error(`Archive absente. Déposez l’archive officielle ici : ${defaultArchive}`)
  const source = new URL(sourceUrl)
  if (source.protocol !== 'https:' || !['download.data.grandlyon.com', 'data.grandlyon.com', 'transport.data.gouv.fr'].includes(source.hostname) || source.username || source.password) {
    throw new Error('La provenance déclarée doit être une URL HTTPS officielle Grand Lyon ou transport.data.gouv.fr.')
  }
  const zip = await openZip(archive)
  for (const file of ['agency.txt', 'routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt']) {
    if (!zip.names.includes(file)) throw new Error(`Fichier obligatoire absent : ${file}`)
  }
  if (!zip.names.includes('calendar.txt') && !zip.names.includes('calendar_dates.txt')) throw new Error('calendar.txt ou calendar_dates.txt est obligatoire.')
  // Ces services ne peuvent pas être transformés en départs exacts sans traitement dédié.
  if (zip.names.includes('frequencies.txt')) throw new Error('frequencies.txt détecté : import refusé pour ne pas afficher les heures de référence comme des départs réels. Prise en charge des fréquences à ajouter.')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(archive)) hash.update(chunk)
  const sha256 = hash.digest('hex')
  await mkdir(outputRoot, { recursive: true })
  const directory = resolve(outputRoot, `import-${sha256.slice(0, 12)}-${Date.now()}`)
  await mkdir(directory) // pas de recursive : ne réutilise jamais une sortie existante
  const databasePath = resolve(directory, 'gtfs.sqlite')
  const db = new DatabaseSync(databasePath)
  db.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-64000;')
  const warnings = []
  const files = {}
  for (const file of ['calendar.txt', 'calendar_dates.txt', 'transfers.txt', 'feed_info.txt']) {
    if (!zip.names.includes(file)) warnings.push(`${file} absent ; ${file === 'transfers.txt' ? 'aucune correspondance importée' : 'les autres fichiers disponibles font foi'}.`)
  }
  const ignoredFiles = zip.names.filter(name => !Object.hasOwn(specs, name))
  let timezone = ''
  let missingTimes = 0
  let maxDepartureSeconds = 0
  try {
    db.exec(await readFile(new URL('../../server/gtfs/schema.sql', import.meta.url), 'utf8'))
    db.exec('BEGIN')
    const tokenInsert = db.prepare('INSERT OR IGNORE INTO search_tokens VALUES(?,?,?)')
    function tokens(kind, id, labels) {
      for (const label of labels) {
        const normalized = normalizeSearch(label)
        const words = normalized.split(' ')
        for (let i = 0; i < words.length; i++) {
          const token = words.slice(i).join(' ')
          if (token) tokenInsert.run(kind, token, id)
        }
      }
    }
    async function load(filename, fn) {
      if (!zip.names.includes(filename)) return
      let count = 0
      for await (const row of csvObjects(zip.read(filename), specs[filename], filename)) {
        try { fn(row); count++ }
        catch (error) { throw new Error(`${filename}, enregistrement ${count + 2} : ${error.message}`) }
      }
      files[filename] = count
      console.log(`${filename} : ${count} enregistrements validés.`)
    }
    const agencyInsert = db.prepare('INSERT INTO agency VALUES(?,?,?,?)')
    await load('agency.txt', row => {
      const zone = required(row, 'agency_timezone')
      new Intl.DateTimeFormat('fr', { timeZone: zone }).format()
      if (zone !== 'Europe/Paris') throw new Error('Ce module TCL attend le fuseau Europe/Paris.')
      timezone = zone
      agencyInsert.run(row.agency_id || '__single_agency__', required(row, 'agency_name'), required(row, 'agency_url'), zone)
    })
    if (!files['agency.txt']) throw new Error('agency.txt ne contient aucune agence.')
    const agencies = db.prepare('SELECT id FROM agency').all()
    const routeInsert = db.prepare('INSERT INTO routes VALUES(?,?,?,?,?)')
    await load('routes.txt', row => {
      const id = required(row, 'route_id')
      if (!row.route_short_name && !row.route_long_name) throw new Error('Nom de ligne absent.')
      const agency = row.agency_id || (agencies.length === 1 ? agencies[0].id : '')
      if (!agency) throw new Error('agency_id requis pour plusieurs agences.')
      routeInsert.run(id, agency, row.route_short_name || '', row.route_long_name || '', integer(row.route_type, 'route_type'))
      tokens('line', id, [id, row.route_short_name || '', row.route_long_name || ''])
    })
    const stopInsert = db.prepare('INSERT INTO stops VALUES(?,?,?,?,?,?,?,?)')
    await load('stops.txt', row => {
      const id = required(row, 'stop_id')
      const type = integer(row.location_type || '0', 'location_type', [0, 1, 2, 3, 4])
      const name = required(row, 'stop_name')
      const latitude = coordinate(row.stop_lat, 90), longitude = coordinate(row.stop_lon, 180)
      if ([0, 1, 2].includes(type) && (latitude === null || longitude === null)) throw new Error('Coordonnées absentes pour cet arrêt/station.')
      stopInsert.run(id, name, row.stop_code || '', row.platform_code || '', row.parent_station || '', latitude, longitude, type)
      if (type === 0) tokens('stop', id, [id, name, row.stop_code || ''])
    })
    const brokenParents = db.prepare("SELECT COUNT(*) AS count FROM stops s LEFT JOIN stops p ON p.id=s.parent_id WHERE s.parent_id<>'' AND p.id IS NULL").get()
    if (brokenParents.count) warnings.push(`${brokenParents.count} arrêts référencent une station parente absente. Les identifiants sont conservés ; recherche et horaires portent uniquement sur les quais existants, sans regroupement inventé.`)
    const serviceInsert = db.prepare('INSERT INTO services VALUES(?,?,?,?,?,?,?,?,?,?)')
    await load('calendar.txt', row => {
      const start = parseGtfsDate(required(row, 'start_date')), end = parseGtfsDate(required(row, 'end_date'))
      if (end < start) throw new Error('Intervalle de service inversé.')
      serviceInsert.run(required(row, 'service_id'), start, end, ...weekdays.map(day => integer(row[day], day, [0, 1])))
    })
    const exceptionService = db.prepare('INSERT OR IGNORE INTO services(id) VALUES(?)')
    const exceptionInsert = db.prepare('INSERT INTO calendar_dates VALUES(?,?,?)')
    await load('calendar_dates.txt', row => {
      const id = required(row, 'service_id')
      exceptionService.run(id)
      exceptionInsert.run(id, parseGtfsDate(required(row, 'date')), integer(row.exception_type, 'exception_type', [1, 2]))
    })
    const tripInsert = db.prepare('INSERT INTO trips VALUES(?,?,?,?,?)')
    await load('trips.txt', row => {
      if (row.direction_id) integer(row.direction_id, 'direction_id', [0, 1])
      tripInsert.run(required(row, 'trip_id'), required(row, 'route_id'), required(row, 'service_id'), row.direction_id || '', row.trip_headsign || '')
    })
    const timeInsert = db.prepare('INSERT INTO stop_times VALUES(?,?,?,?,?,?,?,?,?)')
    await load('stop_times.txt', row => {
      if (row.start_pickup_drop_off_window || row.end_pickup_drop_off_window || row.location_group_id || row.location_id) throw new Error('Transport à la demande non pris en charge par ce calculateur théorique.')
      const timepoint = integer(row.timepoint || '1', 'timepoint', [0, 1])
      const arrival = row.arrival_time ? parseGtfsTime(row.arrival_time) : null
      const departure = row.departure_time ? parseGtfsTime(row.departure_time) : null
      if (timepoint === 1 && (arrival === null || departure === null)) throw new Error('Horaire obligatoire absent pour timepoint=1.')
      if (arrival !== null && departure !== null && departure < arrival) throw new Error('Départ antérieur à l’arrivée.')
      if (departure === null) missingTimes++
      else maxDepartureSeconds = Math.max(maxDepartureSeconds, departure)
      timeInsert.run(required(row, 'trip_id'), required(row, 'stop_id'), integer(row.stop_sequence, 'stop_sequence'), arrival, departure, row.stop_headsign || '', integer(row.pickup_type || '0', 'pickup_type', [0, 1, 2, 3]), integer(row.drop_off_type || '0', 'drop_off_type', [0, 1, 2, 3]), timepoint)
    })
    const invalidStop = db.prepare('SELECT st.stop_id FROM stop_times st JOIN stops s ON s.id=st.stop_id WHERE s.location_type<>0 LIMIT 1').get()
    if (invalidStop) throw new Error(`stop_times doit référencer un arrêt/quai : ${invalidStop.stop_id}`)
    const invalidSequence = db.prepare('SELECT trip_id FROM (SELECT trip_id,arrival,departure,MAX(departure) OVER(PARTITION BY trip_id ORDER BY sequence ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous FROM stop_times) WHERE arrival < previous OR departure < previous LIMIT 1').get()
    if (invalidSequence) throw new Error(`Horaires décroissants : ${invalidSequence.trip_id}`)
    const endpoint = db.prepare('SELECT trip_id FROM stop_times st WHERE (arrival IS NULL OR departure IS NULL) AND (sequence=(SELECT MIN(sequence) FROM stop_times WHERE trip_id=st.trip_id) OR sequence=(SELECT MAX(sequence) FROM stop_times WHERE trip_id=st.trip_id)) LIMIT 1').get()
    if (endpoint) throw new Error(`Horaire absent au premier/dernier arrêt : ${endpoint.trip_id}`)
    const transfersInsert = db.prepare('INSERT INTO transfers(from_stop_id,to_stop_id,from_route_id,to_route_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time) VALUES(?,?,?,?,?,?,?,?)')
    await load('transfers.txt', row => {
      const type = integer(required(row, 'transfer_type'), 'transfer_type', [0, 1, 2, 3, 4, 5])
      if (type < 4 && (!row.from_stop_id || !row.to_stop_id)) throw new Error('Arrêts de correspondance requis.')
      if (type >= 4 && (!row.from_trip_id || !row.to_trip_id)) throw new Error('Courses de correspondance requises.')
      const minimum = row.min_transfer_time ? integer(row.min_transfer_time, 'min_transfer_time') : null
      if (type === 2 && minimum === null) throw new Error('Durée minimale de correspondance absente.')
      transfersInsert.run(row.from_stop_id || null, row.to_stop_id || null, row.from_route_id || null, row.to_route_id || null, row.from_trip_id || null, row.to_trip_id || null, type, minimum)
    })
    for (const file of ['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt']) if (!files[file]) throw new Error(`${file} ne contient aucune donnée.`)
    const unknownService = db.prepare('SELECT t.service_id FROM trips t JOIN services s ON s.id=t.service_id WHERE s.start_date IS NULL AND NOT EXISTS(SELECT 1 FROM calendar_dates c WHERE c.service_id=s.id AND c.exception_type=1) LIMIT 1').get()
    if (unknownService) throw new Error(`Service sans calendrier ni ajout explicite : ${unknownService.service_id}`)
    db.exec('INSERT INTO route_stops SELECT DISTINCT t.route_id,st.stop_id FROM stop_times st JOIN trips t ON t.id=st.trip_id')
    const dates = db.prepare('SELECT MIN(start_date) AS start,MAX(end_date) AS end FROM (SELECT start_date,end_date FROM services WHERE start_date IS NOT NULL UNION ALL SELECT date,date FROM calendar_dates WHERE exception_type=1)').get()
    if (!dates.start) throw new Error('Aucune date de service exploitable.')
    let validFrom = dates.start, validUntil = dates.end
    let feedInfoRows = 0
    await load('feed_info.txt', row => {
      if (feedInfoRows++) throw new Error('Une seule ligne feed_info est prise en charge.')
      if (row.feed_start_date) validFrom = [validFrom, parseGtfsDate(row.feed_start_date)].sort().at(-1)
      if (row.feed_end_date) validUntil = [validUntil, parseGtfsDate(row.feed_end_date)].sort()[0]
    })
    if (validUntil < validFrom) throw new Error('Validité du flux et calendriers incompatibles.')
    if (missingTimes) warnings.push(`${missingTimes} passages sans heure de départ exclus des résultats ; aucune interpolation inventée.`)
    const metadata = { schemaVersion: 1, importedAt: new Date().toISOString(), sourceUrl, sha256, timezone, validFrom, validUntil, maxDepartureSeconds, files, warnings }
    db.prepare('INSERT INTO metadata VALUES(1,?)').run(JSON.stringify(metadata))
    db.exec('COMMIT; PRAGMA optimize;')
    db.close()
    const bytes = (await stat(databasePath)).size
    const report = { ...metadata, archive: resolve(archive), databasePath, bytes, ignoredFiles, provenance: 'URL déclarée par l’utilisateur ; SHA-256 de l’archive locale. Le nom du fichier ne certifie pas son origine.', cloudflare: { belowFreeDatabaseSize: bytes <= 500_000_000, note: 'Vérifier aussi les quotas quotidiens de lecture/écriture D1 avant tout import distant. Aucun déploiement effectué.' } }
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
    const activePath = resolve(outputRoot, 'gtfs.sqlite')
    let activated = false
    try { await copyFile(databasePath, activePath, constants.COPYFILE_EXCL); activated = true }
    catch (error) { if (error.code !== 'EEXIST') throw error }
    return { directory, databasePath, activePath, activated, report }
  } catch (error) {
    try { db.exec('ROLLBACK') } catch { /* Transaction non démarrée ou déjà terminée. */ }
    try { db.close() } catch { /* Base déjà fermée. */ }
    await writeFile(resolve(directory, 'error.txt'), error.stack || String(error), { flag: 'wx' })
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.length > 1) { console.error('Usage : npm run gtfs:import -- [chemin/archive.zip]'); process.exitCode = 1 }
  else {
    try {
      const archive = args[0] ? resolve(args[0]) : await exists(defaultArchive) ? defaultArchive : resolve(projectRoot, 'GTFS_TCL.ZIP')
      const result = await importGtfs({ archive })
      console.log(JSON.stringify(result, null, 2))
      if (!result.activated) console.log('La base active existe déjà et a été préservée. Pour tester ce nouvel import : définir GTFS_DB avec son databasePath puis relancer Vite.')
    } catch (error) { console.error(error.message); process.exitCode = 1 }
  }
}
