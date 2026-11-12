import test from 'node:test'
import assert from 'node:assert/strict'
import { shortClock, localDay, clockDate, crossesClockChange, duration, modeLabel, walkingSummary } from '../experiments/preproduction/results/format.ts'

test('Cartes : heures françaises sans secondes ni décalage visible, données exactes conservées',()=>{
 const instant='2026-11-10T07:05:21.000Z'
 assert.equal(shortClock(instant),'08h05')
 assert.equal(localDay(instant),'2026-11-10')
 assert.ok(!shortClock(instant).includes('UTC'))
 assert.equal(duration(1897),'31 min 37 s')
 assert.equal(new Date(instant).toISOString(),instant)
})

test('Cartes : nuit et changements d’heure Europe/Paris',()=>{
 const before='2026-11-10T22:58:00.000Z',after='2026-11-10T23:05:00.000Z'
 assert.equal(shortClock(before),'23h58');assert.equal(shortClock(after),'00h05')
 assert.notEqual(localDay(before),localDay(after));assert.ok(clockDate(after).includes('11'))
 assert.equal(shortClock('2027-03-28T00:30:00Z'),'01h30')
 assert.equal(shortClock('2027-03-28T01:30:00Z'),'03h30')
 assert.equal(crossesClockChange('2027-03-28T00:30:00Z','2027-03-28T01:30:00Z'),true)
 assert.equal(shortClock('2026-10-25T00:30:00Z'),'02h30')
 assert.equal(shortClock('2026-10-25T01:30:00Z'),'02h30')
 assert.equal(crossesClockChange('2026-10-25T00:30:00Z','2026-10-25T01:30:00Z'),true)
})

test('Cartes : marche inconnue non inventée et modes de transport explicites',()=>{
 const journey={connections:[{walkingSeconds:120},{walkingSeconds:null}],connection:null}
 assert.deepEqual(walkingSummary(journey),{known:120,unknown:true})
 for(const [code,name]of [[0,'Tramway'],[1,'Métro'],[3,'Bus'],[7,'Funiculaire']])assert.equal(modeLabel(code),name)
})
