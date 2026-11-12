import test from 'node:test'
import assert from 'node:assert/strict'
import { routingDatabase, query, auditJourney } from './helpers/journeys.mjs'
import { createNetworkPlanner } from '../server/journeys/network.ts'

// Réseau synthétique : les noms de lignes sont illustratifs, pas des horaires TCL.
// Les deux accès sont des quais GTFS vérifiés, sans marche fictive.
test('Une alternative bus vers tram plus rapide reste explorée et classée', async () => {
  const f = await routingDatabase()
  try {
    f.sqlite.exec("INSERT INTO routes VALUES('BUS2','TEST','TEST BUS2','TEST BUS2',3)")
    f.sqlite.exec("INSERT INTO stops VALUES('A','TEST SECOND ACCESS','','','',45,4,0)")
    f.trip('SLOW_BUS','BUS',[['O',39600],['X',40800]])
    f.trip('FAST_BUS','BUS2',[['A',39720],['Y',40140]])
    f.trip('FAST_TRAM','TRAM',[['Y',40320],['D',41220]])
    f.trip('SLOW_TRAM','TRAM',[['X',41100],['D',42600]])
    const result = await createNetworkPlanner(f.db).search(
      query({maxTransfers:1,order:'arrival'}), [],
      {origins:[{id:'O',seconds:0},{id:'A',seconds:120}],destinations:[{id:'D',seconds:0}]}
    )
    assert.equal(result.state,'ok',JSON.stringify({state:result.state,warnings:result.warnings}))
    assert.ok(result.itineraries.length>0)
    const best = result.itineraries[0]
    assert.equal(best.legs[0].tripId,'FAST_BUS', 'Le bus menant au tram le plus rapide doit être conservé')
    assert.equal(best.legs[1].tripId,'FAST_TRAM')
    assert.ok(result.itineraries.every(j=>j.connections.every(c=>c.intervalSeconds>=c.requiredSeconds)))
  } finally { f.close() }
})

test('Un trajet plus rapide avec correspondance insuffisante doit être exclu', async () => {
  const f = await routingDatabase()
  try {
    f.trip('BUS1','BUS',[['O',39600],['X',40200]])
    f.trip('TRAM_TOO_EARLY','TRAM',[['Y',40260],['D',41000]])
    f.trip('TRAM_VALID','TRAM',[['Y',40500],['D',41600]])
    f.transfer({from:'X',to:'Y',seconds:180})
    const result=await createNetworkPlanner(f.db).search(query({maxTransfers:1}))
    assert.equal(result.state,'ok')
    assert.ok(result.itineraries.every(j=>j.legs.every(l=>l.tripId!=='TRAM_TOO_EARLY')))
    for(const journey of result.itineraries) auditJourney(f.sqlite,result,journey)
  } finally { f.close() }
})
