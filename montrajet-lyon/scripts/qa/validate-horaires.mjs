import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'
import { startBrowser } from './browser-driver.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = resolve(root, `.data/validation-${Date.now()}`)
await mkdir(output)
const report = { startedAt: new Date().toISOString(), checks: [], matrix: [], screenshots: [], errors: [] }
const lines = ['C13', 'C9', 'C16', '125', 'T3']
const stopQueries = ['Place Henri', 'Domrémy-Lacassagne', 'Dauphiné-Lacassagne', 'Vaulx-en-Velin La Soie']
const at = '2026-11-09T10:00:00.000Z'
const clock = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const db = new DatabaseSync(process.env.GTFS_DB || resolve(root, '.data/gtfs.sqlite'), { readOnly: true })
let browser, server
let base = process.env.TEST_BASE_URL

function checked(name, evidence = {}) { report.checks.push({ name, ...evidence }); console.log(`OK ${name}`) }
function datePlus(date, count) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + count); return d.toISOString().slice(0, 10) }
function originParis(date) {
  // Oracle indépendant de server/gtfs/time.ts : détermine l'offset de midi Europe/Paris.
  const noonUTC = Date.parse(`${date}T12:00:00Z`)
  const hours = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(noonUTC))
  return noonUTC - (hours - 12) * 3600000 - 12 * 3600000
}
function oracle(lineId, stopId, instant) {
  const metadata = JSON.parse(db.prepare('SELECT json FROM metadata WHERE id=1').get().json)
  const civil = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
  const source = db.prepare(`SELECT st.*,t.route_id,t.direction_id,t.headsign AS trip_headsign,t.service_id,s.start_date,s.end_date,
    s.monday,s.tuesday,s.wednesday,s.thursday,s.friday,s.saturday,s.sunday
    FROM stop_times st JOIN trips t ON t.id=st.trip_id JOIN services s ON s.id=t.service_id
    WHERE st.stop_id=? AND t.route_id=? AND st.departure IS NOT NULL AND st.pickup_type<>1`).all(stopId, lineId)
  const results = []
  for (let offset = -Math.ceil(metadata.maxDepartureSeconds / 86400) - 1; offset <= 2; offset++) {
    const date = datePlus(civil, offset)
    if (date < metadata.validFrom || date > metadata.validUntil) continue
    const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${date}T12:00:00Z`).getUTCDay()]
    const exceptions = new Map(db.prepare('SELECT service_id,exception_type FROM calendar_dates WHERE date=?').all(date).map(row => [row.service_id, row.exception_type]))
    for (const row of source) {
      const active = exceptions.has(row.service_id) ? exceptions.get(row.service_id) === 1 : date >= row.start_date && date <= row.end_date && row[weekday] === 1
      const epoch = originParis(date) + row.departure * 1000
      if (active && epoch >= instant && epoch < instant + 86400000) results.push({ row, epoch, serviceDate: date })
    }
  }
  return results.sort((a, b) => a.epoch - b.epoch || (a.row.trip_id < b.row.trip_id ? -1 : a.row.trip_id > b.row.trip_id ? 1 : a.row.sequence - b.row.sequence)).slice(0, 12)
}

async function api(path, parameters = {}) {
  const response = await fetch(`${base}/api/gtfs/${path}?${new URLSearchParams(parameters)}`)
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`)
  const body = await response.json()
  assert.equal(body.status, 'connected')
  return body.data
}
function compare(result, lineId, stopId, instant) {
  const expected = oracle(lineId, stopId, instant)
  assert.deepEqual(result.passages.map(p => [p.tripId, p.serviceDate, p.gtfsSeconds, p.headsign, p.directionId]), expected.map(p => [p.row.trip_id, p.serviceDate, p.row.departure, p.row.headsign || p.row.trip_headsign, p.row.direction_id]))
  for (let i = 0; i < result.passages.length; i++) {
    const p = result.passages[i]
    assert.equal(Date.parse(p.departureTime), expected[i].epoch)
    assert.ok(Date.parse(p.departureTime) >= instant)
    assert.equal(p.kind, 'theoretical')
  }
  return expected
}

async function startServer() {
  if (base) return
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } })
  let text = ''
  await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error(`Vite indisponible : ${text}`)), 15000)
    server.on('error', reject)
    server.on('exit', code => { if (!base) reject(new Error(`Vite a quitté : ${code}`)) })
    server.stdout.on('data', data => {
      text += stripVTControlCharacters(data.toString())
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(text)
      if (match) { base = match[0]; clearTimeout(timer); ready() }
    })
    server.stderr.on('data', data => { text += data.toString() })
  })
}

try {
  await startServer()
  report.baseUrl = base
  const metadata = await api('status')
  report.metadata = metadata
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(resolve(root, 'GTFS_TCL.ZIP'))) hash.update(chunk)
  assert.equal(hash.digest('hex'), metadata.sha256)
  checked('Empreinte de l’archive identique à la base active', { sha256: metadata.sha256 })

  const catalog = new Map()
  for (const query of stopQueries) {
    const stops = await api('stops', { q: query })
    assert.ok(stops.length > 0, query)
    assert.equal(new Set(stops.map(s => s.id)).size, stops.length)
    for (const stop of stops) assert.equal(db.prepare('SELECT name FROM stops WHERE id=?').get(stop.id).name, stop.name)
    catalog.set(query, stops)
    checked(`Catalogue : ${query}`, { ids: stops.map(s => s.id) })
  }
  for (const lineId of lines) {
    const results = await api('lines', { q: lineId })
    assert.equal(results.find(r => r.id === lineId)?.shortName, lineId)
    assert.equal(results[0].id, lineId)
    checked(`Catalogue : ${lineId}`)
    for (const query of stopQueries) {
      const stops = await api('stops', { q: query, lineId })
      const expectedIds = catalog.get(query).filter(s => db.prepare('SELECT 1 FROM route_stops WHERE route_id=? AND stop_id=?').get(lineId, s.id)).map(s => s.id)
      // Pour la Soie, la recherche globale est bornée à 20 ; le filtre par ligne peut retrouver d'autres quais.
      assert.ok(expectedIds.every(id => stops.some(s => s.id === id)))
      for (const stop of stops) assert.ok(db.prepare('SELECT 1 FROM route_stops WHERE route_id=? AND stop_id=?').get(lineId, stop.id))
      report.matrix.push({ lineId, query, stops: stops.map(s => ({ id: s.id, name: s.name })) })
    }
  }
  assert.deepEqual(await api('lines', { q: 'aucune-ligne-xyz987' }), [])
  assert.deepEqual(await api('stops', { q: 'aucun-arret-xyz987' }), [])
  checked('API : recherches sans résultat')

  browser = await startBrowser(output)
  report.browser = browser.version
  const d = browser.driver
  const responses = [], requests = new Map(), bodyTasks = []
  d.on('Runtime.exceptionThrown', event => report.errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text))
  const browserSupplierRequests = []
  d.on('Network.requestWillBeSent', event => {
    if (event.request.url.startsWith('https://data.grandlyon.com/')) browserSupplierRequests.push(event.request.url)
    if (event.request.url.startsWith(`${base}/api/gtfs/`) || event.request.url.startsWith(`${base}/api/realtime/`)) requests.set(event.requestId, { url: event.request.url, sentAt: Date.now() })
  })
  d.on('Network.responseReceived', event => {
    const request = requests.get(event.requestId)
    if (request) request.status = event.response.status
  })
  d.on('Network.loadingFinished', event => {
    const request = requests.get(event.requestId)
    if (!request) return
    const task = d.send('Network.getResponseBody', { requestId: event.requestId }).then(body => {
      try { responses.push({ ...request, body: JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body) }) }
      catch { /* Les réponses invalides sont testées séparément. */ }
    }).catch(() => {})
    bodyTasks.push(task)
  })
  report.rootHttpStatus = (await fetch(base)).status
  report.navigation = await d.send('Page.navigate', { url: base })
  await d.wait('document.querySelector("nav button:nth-child(3)")',30000)
  await d.click('nav button:nth-child(3)')
  await d.wait('document.querySelector(".feed-metadata")')
  assert.ok((await d.evaluate('document.body.innerText')).includes('8 mars 2027'))
  checked('Navigateur : frontend React chargé et catalogue connecté')
  const lineInput = '.standalone .gtfs-search-field:nth-child(1) input'
  const stopInput = '.standalone .gtfs-search-field:nth-child(2) input'
  async function selectLine(lineId) {
    await d.type(lineInput, lineId)
    await d.wait(`document.querySelector('.standalone .gtfs-search-field:nth-child(1) .gtfs-options button')`)
    const index = await d.evaluate(`Array.from(document.querySelectorAll('.standalone .gtfs-search-field:nth-child(1) .gtfs-options button')).findIndex(b=>b.querySelector('small').textContent.endsWith('Identifiant '+${JSON.stringify(lineId)}))`)
    assert.ok(index >= 0)
    await d.click(`.standalone .gtfs-search-field:nth-child(1) .gtfs-options li:nth-child(${index + 1}) button`)
    await d.wait(`!document.querySelector(${JSON.stringify(stopInput)}).disabled`)
  }
  async function searchStop(query, count) {
    await d.type(stopInput, query)
    if (!count) await d.wait(`document.querySelector('.standalone .gtfs-search-field:nth-child(2) .search-hint').textContent.includes('Aucun résultat')`)
    else await d.wait(`document.querySelectorAll('.standalone .gtfs-search-field:nth-child(2) .gtfs-options button').length===${count}`)
  }
  async function selectStop(stop, query, count) {
    await searchStop(query, count)
    const index = await d.evaluate(`Array.from(document.querySelectorAll('.standalone .gtfs-search-field:nth-child(2) .gtfs-options button')).findIndex(b=>b.querySelector('small').textContent.includes('Identifiant '+${JSON.stringify(stop.id)}+' ·') || b.querySelector('small').textContent.endsWith('Identifiant '+${JSON.stringify(stop.id)}))`)
    assert.ok(index >= 0, `Quai ${stop.id} sélectionnable`)
    await d.click(`.standalone .gtfs-search-field:nth-child(2) .gtfs-options li:nth-child(${index + 1}) button`)
  }
  async function submit() {
    const previous = responses.length
    await d.click('.standalone form .primary')
    await d.wait(`document.querySelector('.passages-results')`)
    await Promise.allSettled(bodyTasks)
    return responses.slice(previous).findLast(r => new URL(r.url).pathname === '/api/gtfs/passages' && r.status === 200)
  }
  let totalPassages = 0, totalQuays = 0
  for (const lineId of lines) {
    await selectLine(lineId)
    assert.equal(await d.evaluate('document.querySelector(".passages-results")===null'), true)
    for (const entry of report.matrix.filter(row => row.lineId === lineId)) {
      await searchStop(entry.query, entry.stops.length)
      for (const stop of entry.stops) {
        await selectStop(stop, entry.query, entry.stops.length)
        await d.date('2026-11-09T11:00', '.standalone input[type="datetime-local"]')
        const traffic = await submit()
        assert.ok(traffic, 'Réponse réseau réelle du formulaire')
        assert.equal(new URL(traffic.url).searchParams.get('at'), at)
        const expected = compare(traffic.body.data, lineId, stop.id, Date.parse(at))
        const rendered = await d.evaluate(`Array.from(document.querySelectorAll('.passages-list li')).map(li=>({time:li.querySelector('strong').textContent,direction:li.querySelector('div>span').textContent,label:li.querySelector('.theoretical-label').textContent}))`)
        assert.equal(rendered.length, expected.length)
        rendered.forEach((row, index) => {
          assert.equal(row.time, clock.format(expected[index].epoch))
          assert.equal(row.direction, `Direction ${expected[index].row.headsign || expected[index].row.trip_headsign}`)
          assert.ok(row.label.startsWith('Horaire théorique'))
        })
        entry.results ||= []
        entry.results.push({ stopId: stop.id, passages: rendered.length, first: traffic.body.data.passages[0], directions: [...new Set(rendered.map(r => r.direction))] })
        totalPassages += rendered.length; totalQuays++
      }
    }
    checked(`Navigateur : ligne ${lineId}, arrêts filtrés et passages conformes à SQLite`)
  }
  checked('Comparaison indépendante des horaires affichés et de SQLite', { totalPassages, totalQuays, at })

  await selectLine('C13')
  const liveEntry = report.matrix.find(r => r.lineId === 'C13' && r.query === 'Place Henri')
  await selectStop(liveEntry.stops[0], liveEntry.query, liveEntry.stops.length)
  await d.date('', '.standalone input[type="datetime-local"]')
  const liveResponse = await submit()
  const realtimeStatus = await (await fetch(`${base}/api/realtime/status`)).json()
  assert.equal(realtimeStatus.state, 'disabled')
  assert.ok(['authentication_required', 'policy_unconfirmed', 'mapping_unconfirmed'].includes(realtimeStatus.reason))
  await d.wait(`document.querySelector('.realtime-panel')?.textContent.includes(${JSON.stringify(realtimeStatus.reason === 'authentication_required' ? 'authentification serveur non configurée' : realtimeStatus.reason === 'policy_unconfirmed' ? 'en attente de validation des conditions' : 'en attente de vérification des identifiants')})`)
  assert.ok(await d.evaluate(`document.querySelectorAll('.passages-list li').length>0 && document.querySelectorAll('.estimated-label').length===0`))
  checked('Navigateur : temps réel bloqué explicitement, aucun faux E et repli GTFS visible', { reason: realtimeStatus.reason })
  await delay(100)
  const fallbackScreenshot = resolve(output, 'temps-reel-indisponible-repli-gtfs.png')
  await d.screenshot(fallbackScreenshot); report.screenshots.push(fallbackScreenshot)
  assert.ok(liveResponse.body.data.passages.length > 1)
  assert.ok(liveResponse.body.data.passages.every(p => Date.parse(p.departureTime) >= liveResponse.sentAt))
  const expiredLabel = await d.evaluate(`document.querySelector('.passages-list li strong').textContent`)
  const afterFirst = Date.parse(liveResponse.body.data.passages[0].departureTime) + 1000
  await d.evaluate(`window.__qaNow=Date.now;Date.now=()=>${afterFirst};document.dispatchEvent(new Event('visibilitychange'))`)
  try {
    await d.wait(`document.querySelector('.passages-list li strong')?.textContent!==${JSON.stringify(expiredLabel)}`, 3000)
    const afterLast = Date.parse(liveResponse.body.data.passages.at(-1).departureTime) + 1000
    await d.evaluate(`Date.now=()=>${afterLast};document.dispatchEvent(new Event('visibilitychange'))`)
    await d.wait(`!document.querySelector('.passages-list li')`, 3000)
    checked('Navigateur : les passages expirés disparaissent en consultation courante, sans nouvel horaire inventé')
  } finally { await d.evaluate(`Date.now=window.__qaNow;delete window.__qaNow;document.dispatchEvent(new Event('visibilitychange'))`) }

  // Cas négatifs du formulaire, sans modification de la base.
  await d.type(lineInput, 'aucune-ligne-xyz987')
  await d.wait(`document.querySelector('.standalone .gtfs-search-field:nth-child(1) .search-hint').textContent.includes('Aucun résultat')`)
  assert.equal(await d.evaluate('document.querySelector(".passages-results")===null'), true)
  checked('Navigateur : ligne inconnue et effacement des résultats précédents')
  await selectLine('C13')
  const entry = report.matrix.find(r => r.lineId === 'C13' && r.query === 'Place Henri')
  await selectStop(entry.stops[0], entry.query, entry.stops.length)
  await d.date('2028-01-01T12:00', '.standalone input[type="datetime-local"]')
  await submit()
  await d.wait(`document.querySelector('.passages-results').textContent.includes('hors de la période')`)
  assert.equal(await d.evaluate('document.querySelectorAll(".passages-list li").length'), 0)
  checked('Navigateur : date hors validité sans horaire de substitution')

  // Interception limitée au navigateur de test : une erreur ou un retard, jamais de faux horaires.
  let mode = '', release
  d.on('Fetch.requestPaused', async event => {
    const path = new URL(event.request.url).pathname
    if ((mode === 'slow' && path.endsWith('/passages')) || (mode === 'catalogue-slow' && path.endsWith('/status')) || (mode === 'line-slow' && path.endsWith('/lines'))) {
      release = () => d.send('Fetch.continueRequest', { requestId: event.requestId })
    } else if ((mode === 'error' && path.endsWith('/passages')) || (mode === 'catalogue-error' && path.endsWith('/status'))) {
      await d.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 503, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ status: 'disconnected', message: 'Erreur API de validation contrôlée.' })).toString('base64') })
    } else await d.send('Fetch.continueRequest', { requestId: event.requestId })
  })
  await d.send('Fetch.enable', { patterns: [{ urlPattern: `${base}/api/gtfs/*`, requestStage: 'Request' }] })
  await d.date('2026-11-09T11:00', '.standalone input[type="datetime-local"]')
  mode = 'slow'
  await d.click('.standalone form .primary')
  await d.wait(`document.querySelector('.standalone form .primary').disabled && document.querySelector('.standalone form .primary').textContent.includes('Recherche')`)
  while (!release) await delay(20)
  checked('Navigateur : chargement visible et soumission désactivée pendant la requête')
  await release(); mode = ''
  await d.wait(`document.querySelector('.passages-results')`)
  mode = 'error'
  await d.click('.standalone form .primary')
  await d.wait(`document.querySelector('.message[role="status"]')?.textContent.includes('Erreur API de validation')`)
  assert.equal(await d.evaluate('document.querySelector(".passages-results")===null'), true)
  checked('Navigateur : erreur API explicite sans conservation d’anciens horaires')
  mode = ''
  await d.click('.standalone form .primary')
  await d.wait(`document.querySelector('.passages-list li')`)

  // Le catalogue lui-même peut être indisponible : formulaire bloqué, retry réel.
  await d.click('nav button:nth-child(1)')
  mode = 'catalogue-error'
  await d.click('nav button:nth-child(3)')
  await d.wait(`document.querySelector('.disconnected')?.textContent.includes('Erreur API de validation')`)
  assert.ok(await d.evaluate(`Array.from(document.querySelectorAll('.standalone .gtfs-search-field input')).every(i=>i.disabled) && document.querySelector('.standalone form .primary').disabled`))
  checked('Navigateur : catalogue indisponible, erreur visible et recherche désactivée')
  mode = 'catalogue-slow'; release = undefined
  await d.click('.disconnected button')
  await d.wait(`document.querySelector('.message[role="status"]')?.textContent.includes('Connexion au catalogue') && !document.querySelector('.disconnected')`)
  while (!release) await delay(20)
  await release(); mode = ''
  await d.wait(`document.querySelector('.feed-metadata')`)
  checked('Navigateur : chargement du catalogue distinct d’une erreur, reconnexion réussie')

  // Saisie successive : un résultat de ligne ancien ne doit pas remplacer le nouveau.
  mode = 'line-slow'; release = undefined
  await d.type(lineInput, 'C9')
  await d.wait(`document.querySelector('.standalone .gtfs-search-field:nth-child(1) .search-hint').textContent.includes('Recherche')`)
  while (!release) await delay(20)
  mode = ''
  const releaseOld = release
  await d.type(lineInput, 'C13')
  await releaseOld().catch(() => {})
  await d.wait(`document.querySelector('.standalone .gtfs-search-field:nth-child(1) .gtfs-options button small')?.textContent.endsWith('Identifiant C13')`)
  checked('Navigateur : chargement de recherche et réponse obsolète ignorée')
  await d.send('Fetch.disable')
  await selectLine('C13')
  await selectStop(entry.stops[0], entry.query, entry.stops.length)
  await d.date('2026-11-09T11:00', '.standalone input[type="datetime-local"]')
  await submit()
  await delay(350)
  const desktop = resolve(output, 'horaires-desktop.png')
  await d.screenshot(desktop); report.screenshots.push(desktop)

  for (const width of [768, 390, 320]) {
    await d.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 700 })
    await delay(100)
    const dimensions = await d.evaluate('({width:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth})')
    assert.ok(dimensions.document <= width, `Débordement à ${width}px : ${JSON.stringify(dimensions)}`)
    assert.ok(await d.evaluate('Array.from(document.querySelectorAll("input")).every(i=>i.getBoundingClientRect().right<=innerWidth && i.getBoundingClientRect().left>=0)'))
    const path = resolve(output, `horaires-${width}.png`)
    await d.screenshot(path); report.screenshots.push(path)
    checked(`Navigateur : largeur ${width}px sans débordement horizontal`, dimensions)
  }
  await selectLine('T3')
  const mobileEntry = report.matrix.find(r => r.lineId === 'T3' && r.query === 'Vaulx-en-Velin La Soie')
  await searchStop(mobileEntry.query, mobileEntry.stops.length)
  const suggestions = resolve(output, 'homonymes-mobile-320.png')
  await d.screenshot(suggestions); report.screenshots.push(suggestions)
  await selectStop(mobileEntry.stops[0], mobileEntry.query, mobileEntry.stops.length)
  const mobileResponse = await submit()
  compare(mobileResponse.body.data, 'T3', mobileEntry.stops[0].id, Date.parse(at))
  checked('Navigateur : recherche complète T3 / Vaulx-en-Velin La Soie à 320px')
  await Promise.allSettled(bodyTasks)
  assert.equal(report.errors.length, 0, report.errors.join('\n'))
  assert.equal(browserSupplierRequests.length, 0)
  report.browserSupplierRequests = browserSupplierRequests
  checked('Navigateur : aucun appel direct à Grand Lyon')
  report.network = responses
  report.finishedAt = new Date().toISOString()
  report.status = 'passed'
  console.log(`Rapport : ${output}`)
} catch (error) {
  report.status = 'failed'
  report.failure = error.stack || String(error)
  if (browser) {
    try { await browser.driver.screenshot(resolve(output, 'failure.png')) } catch { /* Meilleur effort. */ }
    try { report.failureDom = await browser.driver.evaluate('document.body.innerText'); report.failurePage = await browser.driver.evaluate('({url:location.href,title:document.title,readyState:document.readyState,html:document.documentElement.outerHTML.slice(0,1000)})') } catch { /* Navigateur arrêté. */ }
  }
  console.error(error)
  process.exitCode = 1
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  if (browser) await browser.close()
  if (server) server.kill()
  db.close()
}

