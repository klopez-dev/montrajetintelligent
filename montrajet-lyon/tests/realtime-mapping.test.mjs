import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapEstimates,parseProviderRow } from '../server/realtime/mapping.ts'
import { providerInstant } from '../server/realtime/time.ts'
import { currentEstimates } from '../src/services/realtime.ts'
import { database,instant,row } from './helpers/realtime.mjs'

async function mapped(t,rows) {const db=await database();t.after(()=>db.sqlite.close());return mapEstimates(db,rows,'TEST_LINE','TEST_STOP',instant,120000)}
test('Identifiants exacts, course, destination et direction cohérentes donnent une estimation',async t=>{
  const r=await mapped(t,[row()]);assert.equal(r.estimates.length,1);assert.equal(r.estimates[0].kind,'estimated');assert.equal(r.estimates[0].estimatedTime,'2026-11-09T10:05:00.000Z');assert.equal(r.statistics.matchRate,1)
})
test('Un quai homonyme ne correspond jamais au quai sélectionné',async t=>{
  assert.equal((await mapped(t,[row({id:'TEST_OTHER_QUAY'})])).estimates.length,0)
})
test('gid ne remplace jamais id pour identifier un arrêt',async t=>{
  assert.equal((await mapped(t,[row({id:'UNKNOWN',gid:'TEST_STOP'})])).estimates.length,0)
})
test('Aucun retrait heuristique de suffixe de ligne ou de course',async t=>{
  for(const changes of [{ligne:'TEST_LINEA'},{coursetheorique:'TEST_TRIP:1'}])assert.equal((await mapped(t,[row(changes)])).estimates.length,0)
})
test('Direction opposée, destination inconnue ou en amont : refuser la correspondance',async t=>{
  for(const changes of [{direction:'OPPOSITE'},{idtarretdestination:'UNKNOWN'},{idtarretdestination:'TEST_STOP'}])assert.equal((await mapped(t,[row(changes)])).estimates.length,0)
})
test('Un type T reste théorique et ne donne aucune estimation',async t=>{
  const r=await mapped(t,[row({type:'T'})]);assert.equal(r.estimates.length,0);assert.equal(r.statistics.matched,1)
})
test('Données incomplètes, type inconnu et nombres non sûrs sont rejetés',async t=>{
  assert.equal(parseProviderRow(row({gid:undefined})),null);assert.equal(parseProviderRow(row({type:'X'})),null);assert.equal(parseProviderRow(row({id:Number.MAX_SAFE_INTEGER+1})),null)
  assert.equal((await mapped(t,[{id:'TEST_STOP'}])).estimates.length,0)
})
test('Source périmée, départ passé et source datée dans le futur sont exclus',async t=>{
  for(const changes of [{last_update_fme:'2026-11-09T09:57:59Z'},{heurepassage:'2026-11-09T09:59:59Z'},{last_update_fme:'2026-11-09T10:01:00Z'}])assert.equal((await mapped(t,[row(changes)])).estimates.length,0)
})
test('Dédoublonner uniquement le même trip/quai/instant, sans fusionner les quais',async t=>{
  const r=await mapped(t,[row(),row({gid:2})]);assert.equal(r.estimates.length,1)
})
test('Aucun échantillon : taux non mesurable, jamais un faux 0 %',async t=>{
  const r=await mapped(t,[]);assert.equal(r.statistics.matchRate,null)
})
test('Heures locales Europe/Paris : hiver, été, date invalide et passage de minuit',()=>{
  assert.equal(providerInstant('2026-11-09 11:00:00'),Date.parse('2026-11-09T10:00:00Z'))
  assert.equal(providerInstant('2026-07-09 11:00:00'),Date.parse('2026-07-09T09:00:00Z'))
  assert.equal(providerInstant('2026-11-10 00:05:00'),Date.parse('2026-11-09T23:05:00Z'))
  assert.equal(providerInstant('2026-02-30 11:00:00'),null)
})
test('Changements d’heure : refuser les heures locales inexistantes et ambiguës',()=>{
  assert.equal(providerInstant('2026-03-29 02:30:00'),null)
  assert.equal(providerInstant('2026-10-25 02:30:00'),null)
  assert.equal(providerInstant('2026-10-25T02:30:00+02:00'),Date.parse('2026-10-25T00:30:00Z'))
  assert.equal(providerInstant('2026-10-25T02:30:00+01:00'),Date.parse('2026-10-25T01:30:00Z'))
})
test('Affichage : retirer les estimations dès expiration, sans transformer un T en E',async t=>{
  const r=await mapped(t,[row()]);assert.equal(currentEstimates(r.estimates,instant).length,1)
  assert.equal(currentEstimates(r.estimates,Date.parse(r.estimates[0].validUntil)).length,0)
  assert.equal(currentEstimates([{...r.estimates[0],kind:'theoretical'}],instant)[0].kind,'theoretical')
})
