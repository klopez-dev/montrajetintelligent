import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import { getPassages, searchLines, searchStops, getDirections } from '../server/gtfs/repository.ts'
import { handleGtfsRequest } from '../server/gtfs/api.ts'
import { onRequest } from '../functions/api/gtfs/[[path]].ts'
import { serviceDayOrigin } from '../server/gtfs/time.ts'

// Données unitaires artificielles, confinées en mémoire. Jamais importées dans l’application.
let sqlite, db
const metadata = { schemaVersion:1, importedAt:'2026-11-08T10:00:00Z',sourceUrl:'https://www.example.org/unit-tests-only',sha256:'test',timezone:'Europe/Paris',validFrom:'2026-03-01',validUntil:'2026-12-31',maxDepartureSeconds:176400,files:{},warnings:[] }
beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:')
  sqlite.exec(await readFile(new URL('../server/gtfs/schema.sql', import.meta.url),'utf8'))
  sqlite.prepare('INSERT INTO metadata VALUES(1,?)').run(JSON.stringify(metadata))
  sqlite.exec(`
    INSERT INTO agency VALUES('A','TEST','https://example.org','Europe/Paris');
    INSERT INTO routes VALUES('R','A','TEST','Ligne de test',3);
    INSERT INTO stops VALUES('S1','École','CODE1','A','',45,4,0),('S2','École','CODE2','B','',45,4,0);
    INSERT INTO search_tokens VALUES('line','test','R'),('stop','ecole','S1'),('stop','ecole','S2');
    INSERT INTO route_stops VALUES('R','S1');
    INSERT INTO services VALUES('W','2026-03-01','2026-12-31',1,1,1,1,1,0,0);
    INSERT INTO services(id) VALUES('X');
  `)
  db = { all: async (sql, params=[]) => sqlite.prepare(sql).all(...params) }
})
afterEach(() => sqlite.close())
function trip(id, seconds, service='W', pickup=0, timepoint=1, direction='0') {
  sqlite.prepare('INSERT INTO trips VALUES(?,?,?,?,?)').run(id,'R',service,direction,'Destination test')
  sqlite.prepare('INSERT INTO stop_times VALUES(?,?,?,?,?,?,?,?,?)').run(id,'S1',1,seconds,seconds,'',pickup,0,timepoint)
}
test('Les homonymes restent distincts et sont filtrés par ligne', async () => {
  const all = await searchStops(db,'ÉCOLE')
  assert.deepEqual(all.map(s=>s.id),['S1','S2'])
  assert.notEqual(all[0].code, all[1].code)
  assert.deepEqual((await searchStops(db,'ecole','R')).map(s=>s.id),['S1'])
  assert.equal((await searchLines(db,'test')).length,1)
  assert.deepEqual(await searchStops(db,''),[])
  assert.deepEqual(await searchStops(db,"'; DROP TABLE stops;--"),[])
})
test('Départ de la veille après 24 h conservé et trié avec le jour courant', async () => {
  trip('NIGHT', 25*3600)
  trip('MORNING', 2*3600)
  const result=await getPassages(db,'R','S1',Date.parse('2026-11-10T00:30:00+01:00'))
  assert.equal(result.passages[0].tripId,'NIGHT')
  assert.equal(result.passages[0].serviceDate,'2026-11-09')
  assert.equal(result.passages[0].departureTime,'2026-11-10T00:00:00.000Z')
  assert.equal(result.passages[1].tripId,'MORNING')
  assert.ok(result.passages.every(p=>p.kind==='theoretical'))
})
test('Départ à 49 h rattaché au service deux jours avant', async () => {
  trip('LONG', 49*3600)
  const r=await getPassages(db,'R','S1',Date.parse('2026-11-11T00:30:00+01:00'))
  assert.equal(r.passages[0].serviceDate,'2026-11-09')
  assert.equal(r.passages[0].departureTime,'2026-11-11T00:00:00.000Z')
})
test('Suppression d’un jour férié et ajout sans calendar.txt dans la requête SQL', async () => {
  trip('REGULAR',8*3600)
  trip('ADDED',9*3600,'X')
  sqlite.exec("INSERT INTO calendar_dates VALUES('W','2026-11-11',2),('X','2026-11-11',1)")
  const r=await getPassages(db,'R','S1',Date.parse('2026-11-11T07:00:00+01:00'))
  assert.deepEqual(r.passages.map(p=>p.tripId),['ADDED'])
})
test('Les exceptions du jour courant ne suppriment pas un départ de la veille', async () => {
  trip('NIGHT',25*3600)
  sqlite.exec("INSERT INTO calendar_dates VALUES('W','2026-11-10',2)")
  const r=await getPassages(db,'R','S1',Date.parse('2026-11-10T00:30:00+01:00'))
  assert.equal(r.passages.length,1)
  assert.equal(r.passages[0].serviceDate,'2026-11-09')
})
test('Bornes : inclure maintenant, exclure les départs passés et la fin de fenêtre', async () => {
  trip('PAST',8*3600-1);trip('NOW',8*3600);trip('END',8*3600+24*3600)
  const r=await getPassages(db,'R','S1',Date.parse('2026-11-09T08:00:00+01:00'))
  assert.ok(r.passages.some(p=>p.tripId==='NOW'&&p.serviceDate==='2026-11-09'))
  assert.ok(r.passages.every(p=>Date.parse(p.departureTime)>=Date.parse('2026-11-09T07:00:00Z')&&Date.parse(p.departureTime)<Date.parse(r.windowEnd)))
})
test('Pas de montée interdite ni d’interpolation inventée ; marqueur source conservé', async () => {
  trip('NO_PICKUP',8*3600,'W',1)
  trip('SOURCE_ESTIMATE',9*3600,'W',0,0)
  trip('NO_TIME',null,'W',0,0)
  const r=await getPassages(db,'R','S1',Date.parse('2026-11-09T07:00:00+01:00'))
  assert.deepEqual(r.passages.map(p=>p.tripId),['SOURCE_ESTIMATE'])
  assert.equal(r.passages[0].interpolated,true)
})
test('Limite des résultats et directions distinctes', async () => {
  for(let i=0;i<20;i++)trip(`T${i}`,8*3600+i*60,'W',0,1,String(i%2))
  const r=await getPassages(db,'R','S1',Date.parse('2026-11-09T07:00:00+01:00'),'1')
  assert.ok(r.passages.every(p=>p.directionId==='1'))
  const all=await getPassages(db,'R','S1',Date.parse('2026-11-09T07:00:00+01:00'))
  assert.equal(all.passages.length,12)
  assert.equal((await getDirections(db,'R','S1')).length,2)
})
test('Données périmées : aucun recyclage des horaires sur une date non couverte', async () => {
  trip('OLD',8*3600)
  const r=await getPassages(db,'R','S1',Date.parse('2028-01-01T00:00:00Z'))
  assert.equal(r.outsideValidity,true)
  assert.deepEqual(r.passages,[])
})
test('Les dernières courses dépassant minuit restent valides après la fin du dernier jour de service', async () => {
  trip('LAST',25*3600)
  const r=await getPassages(db,'R','S1',Date.parse('2027-01-01T00:30:00+01:00'))
  assert.equal(r.outsideValidity,false)
  assert.equal(r.passages[0].serviceDate,'2026-12-31')
})
test('Le moteur SQL respecte le changement d’heure été et hiver', async () => {
  trip('DST',8*3600,'X')
  sqlite.exec("INSERT INTO calendar_dates VALUES('X','2026-03-29',1),('X','2026-10-25',1)")
  for(const [date,expected] of [['2026-03-29','2026-03-29T06:00:00.000Z'],['2026-10-25','2026-10-25T07:00:00.000Z']]){
    const r=await getPassages(db,'R','S1',serviceDayOrigin(date,'Europe/Paris')+7*3600_000)
    assert.equal(r.passages[0].departureTime,expected)
  }
})
test('API : absence de base, méthodes, ressources et paramètres incorrects', async () => {
  const req=path=>new Request(`https://example.org/api/gtfs/${path}`)
  assert.equal((await handleGtfsRequest(req('status'),null)).status,503)
  assert.equal((await handleGtfsRequest(req('bad'),db)).status,404)
  assert.equal((await handleGtfsRequest(new Request(req('status'),{method:'POST'}),db)).status,405)
  for(const path of ['passages','passages?lineId=R&stopId=S1&at=bad','passages?lineId=R&stopId=S1&at=2026-11-09T12:00:00','passages?lineId=R&stopId=S1&at=2026-02-30T12:00:00Z','passages?lineId=R&stopId=S1&direction=2']){
    assert.equal((await handleGtfsRequest(req(path),db)).status,400)
  }
})
test('Le contrat HTTP renvoie des résultats bornés et jamais la base complète', async () => {
  trip('HTTP',8*3600)
  const response=await handleGtfsRequest(new Request('https://example.org/api/gtfs/passages?lineId=R&stopId=S1&at=2026-11-09T06:00:00Z'),db)
  assert.equal(response.status,200)
  const body=await response.json()
  assert.equal(body.status,'connected');assert.equal(body.data.passages[0].kind,'theoretical')
  assert.equal('stop_times' in body.data,false)
})
test('Adaptateur Cloudflare D1 : même contrat avec un binding préparé', async () => {
  const GTFS_DB = {
    prepare: sql => ({ bind: (...params) => ({ all: async () => ({ results: sqlite.prepare(sql).all(...params) }) }) }),
  }
  const response=await onRequest({request:new Request('https://example.org/api/gtfs/lines?q=test'),env:{GTFS_DB}})
  assert.equal(response.status,200)
  assert.equal((await response.json()).data[0].id,'R')
})
