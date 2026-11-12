import test from 'node:test'
import assert from 'node:assert/strict'
import { routingDatabase, query, auditJourney } from './helpers/journeys.mjs'
import { createJourneyPlanner } from '../server/journeys/planner.ts'

function verifiedWalk(seconds){return [{from:'X',to:'Y',path:{source:'IGN BD TOPO',profile:'pedestrian',resourceVersion:'TEST',fetchedAt:'2026-11-09T10:00:00Z',durationSeconds:seconds,distanceMeters:200,startSnapMeters:0,endSnapMeters:0,geometry:{type:'LineString',coordinates:[[4,45],[4.001,45.001]]}}}]}

test('Minimum GTFS et marche IGN : retenir la plus longue duree dans les deux moteurs',async t=>{
  const f=await routingDatabase();t.after(f.close);f.connection()
  const planner=createJourneyPlanner(f.db)
  for(const maxTransfers of [1,2]){
    const q=query({maxTransfers})
    assert.equal((await planner.search(q,verifiedWalk(240))).state,'ok')
    const result=await planner.search(q,verifiedWalk(150))
    assert.equal(result.state,'ok')
    const connection=result.itineraries[0].connection
    assert.equal(connection.officialMinimumSeconds,180)
    assert.equal(connection.walkingSeconds,150)
    assert.equal(connection.requiredSeconds,180)
    assert.equal(connection.walkingPath.durationSeconds,150)
    auditJourney(f.sqlite,result,result.itineraries[0])
  }
})

test('Bus vers metro entre deux quais : duree officielle, marge et calendrier controles',async t=>{
  const f=await routingDatabase();t.after(f.close)
  f.trip('BUS_A','BUS',[['O',39600],['X',40200]])
  f.trip('METRO_A','METRO',[['Y',40500],['D',41100]])
  f.trip('METRO_B','METRO',[['Y',40500],['D',41101]])
  f.transfer({seconds:180})
  for(const maxTransfers of [1,2]){
    const result=await createJourneyPlanner(f.db).search(query({maxTransfers}))
    assert.equal(result.state,'ok')
    assert.equal(result.itineraries[0].transfers,1)
    assert.deepEqual(result.itineraries[0].legs.map(leg=>leg.routeType),[3,1])
    assert.equal(result.itineraries[0].connection.intervalSeconds,300)
    auditJourney(f.sqlite,result,result.itineraries[0])
    assert.equal((await createJourneyPlanner(f.db).search(query({maxTransfers,marginSeconds:121}))).state,'ok')
  }
})

test('Plusieurs lignes au meme quai : seules les courses reellement parcourues sont proposees',async t=>{
  const f=await routingDatabase();t.after(f.close)
  f.trip('BUS_DIRECT','BUS',[['O',39600],['D',40800]])
  f.trip('TRAM_DIRECT','TRAM',[['O',39630],['D',40830]])
  f.trip('METRO_WRONG','METRO',[['D',39600],['O',40800]])
  const result=await createJourneyPlanner(f.db).search(query({maxTransfers:2}))
  assert.equal(result.state,'ok')
  assert.deepEqual(new Set(result.itineraries.map(j=>j.legs[0].tripId)),new Set(['BUS_DIRECT','TRAM_DIRECT']))
  result.itineraries.forEach(j=>auditJourney(f.sqlite,result,j))
})
