import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapStopPassages, mapEstimates } from '../server/realtime/mapping.ts'
import { database, instant, row } from './helpers/realtime.mjs'

test('Niveau 1 accepte E et T sur une course et un quai exacts sans destination prouvee', async t => {
  const db = await database(); t.after(() => db.sqlite.close())
  const rows = [row({ direction: 'TERMINUS COMMERCIAL', idtarretdestination: 'UNKNOWN' }), row({ type: 'T', direction: 'TERMINUS COMMERCIAL', idtarretdestination: 'UNKNOWN', heurepassage: '2026-11-09T10:06:00Z' })]
  const one = await mapStopPassages(db, rows, 'TEST_LINE', 'TEST_STOP', instant, 120000)
  const two = await mapEstimates(db, rows, 'TEST_LINE', 'TEST_STOP', instant, 120000)
  assert.deepEqual(one.estimates.map(item => item.kind), ['estimated', 'theoretical'])
  assert.ok(one.estimates.every(item => item.directionReliable === false))
  assert.equal(two.estimates.length, 0)
})

test('Niveau 1 refuse homonyme, course absente, donnees perimees et passage expire', async t => {
  const db = await database(); t.after(() => db.sqlite.close())
  for (const bad of [row({ id: 'TEST_OTHER_QUAY' }), row({ coursetheorique: 'UNKNOWN' }), row({ last_update_fme: '2026-11-09T09:57:00Z' }), row({ heurepassage: '2026-11-09T09:59:00Z' })]) {
    const result = await mapStopPassages(db, [bad], 'TEST_LINE', 'TEST_STOP', instant, 120000)
    assert.equal(result.estimates.length, 0)
  }
})

test('Niveau 1 respecte les exceptions de calendrier et les heures GTFS apres minuit', async t => {
  const db = await database(); t.after(() => db.sqlite.close())
  db.sqlite.prepare('UPDATE stop_times SET departure=? WHERE trip_id=? AND stop_id=?').run(25 * 3600 + 5 * 60, 'TEST_TRIP', 'TEST_STOP')
  const now = Date.parse('2026-11-09T23:58:00Z')
  const midnight = row({ heurepassage: '2026-11-10T00:05:00Z', last_update_fme: '2026-11-09T23:57:50Z' })
  assert.equal((await mapStopPassages(db, [midnight], 'TEST_LINE', 'TEST_STOP', now, 120000)).estimates.length, 1)
  db.sqlite.prepare('INSERT INTO calendar_dates VALUES(?,?,2)').run('TEST_SERVICE', '2026-11-09')
  assert.equal((await mapStopPassages(db, [midnight], 'TEST_LINE', 'TEST_STOP', now, 120000)).estimates.length, 0)
})

test('Deux courses proches restent distinctes ; direction divergente non confirmee',async t=>{
  const db=await database();t.after(()=>db.sqlite.close())
  db.sqlite.exec("INSERT INTO trips VALUES('TEST_TRIP_B','TEST_LINE','TEST_SERVICE','0','TEST DESTINATION'); INSERT INTO stop_times VALUES('TEST_TRIP_B','TEST_STOP',1,39930,39930,'',0,0,1),('TEST_TRIP_B','TEST_DEST',2,40530,40530,'',1,0,1);")
  const result=await mapStopPassages(db,[row({direction:'AUTRE TERMINUS'}),row({coursetheorique:'TEST_TRIP_B',heurepassage:'2026-11-09T10:05:30Z'})],'TEST_LINE','TEST_STOP',instant,120000)
  assert.deepEqual(result.estimates.map(item=>item.tripId),['TEST_TRIP','TEST_TRIP_B'])
  assert.equal(result.estimates[0].directionReliable,false)
  assert.equal(result.estimates[1].directionReliable,true)
})
