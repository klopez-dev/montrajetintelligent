import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createJourneyPlanner } from '../server/journeys/planner.ts'
import { scheduledLegs,serviceDays } from '../server/journeys/schedules.ts'
import { auditJourney } from './helpers/journeys.mjs'
const path=process.env.GTFS_DB||fileURLToPath(new URL('../.data/gtfs.sqlite',import.meta.url))
const cases=[['Place Henri','2397','36394'],['Domrémy-Lacassagne','12230','36394'],['Dauphiné-Lacassagne','35660','35668']]
for(const route of ['F1','F2'])test(`Funiculaire ${route} : calcul direct vérifié dans les horaires réels du GTFS`,{skip:!existsSync(path)},async()=>{
  const sqlite=new DatabaseSync(path,{readOnly:true})
  try{
    const sample=sqlite.prepare(`SELECT a.stop_id AS origin,b.stop_id AS destination FROM trips t
      JOIN stop_times a ON a.trip_id=t.id JOIN stop_times b ON b.trip_id=t.id AND b.sequence>a.sequence
      WHERE t.route_id=? AND a.departure BETWEEN 39600 AND 60000 AND a.pickup_type=0 AND b.drop_off_type=0 LIMIT 1`).get(route)
    assert.ok(sample)
    const r=await createJourneyPlanner({all:async(sql,params=[])=>sqlite.prepare(sql).all(...params)}).search({fromStopId:sample.origin,toStopId:sample.destination,at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:120})
    assert.equal(r.state,'ok');assert.ok(r.itineraries.some(j=>j.transfers===0&&j.legs[0].routeId===route&&j.legs[0].routeType===7))
    r.itineraries.forEach(j=>auditJourney(sqlite,r,j))
  }finally{sqlite.close()}
})
for(const [name,fromStopId,toStopId] of cases)for(const mode of ['departure','arrival'])test(`GTFS réel : ${name} → La Soie, ${mode}`,{skip:!existsSync(path)},async()=>{
  const sqlite=new DatabaseSync(path,{readOnly:true})
  try{
    const db={all:async(sql,values=[])=>sqlite.prepare(sql).all(...values)}
    const r=await createJourneyPlanner(db).search({fromStopId,toStopId,at:'2026-11-09T10:00:00Z',mode,marginSeconds:120,order:mode==='arrival'?'departure':'arrival'})
    assert.equal(r.state,'ok');assert.ok(r.itineraries.length>1)
    r.itineraries.forEach(j=>auditJourney(sqlite,r,j))
    if(fromStopId==='35660')assert.ok(r.itineraries.every(j=>j.transfers===0&&j.legs[0].routeId==='T3'))
    else assert.ok(r.itineraries.every(j=>j.connection.source==='gtfs'))
  }finally{sqlite.close()}
})
test('GTFS réel : pas de bus → T3 à Dauphiné inventé à partir du lien inverse',{skip:!existsSync(path)},async()=>{
  const sqlite=new DatabaseSync(path,{readOnly:true})
  try{
    const db={all:async(sql,values=[])=>sqlite.prepare(sql).all(...values)}
    assert.ok(sqlite.prepare("SELECT 1 FROM transfers WHERE from_stop_id='35660' AND to_stop_id='10129'").get())
    assert.equal(sqlite.prepare("SELECT 1 FROM transfers WHERE from_stop_id='10129' AND to_stop_id='35660'").get(),undefined)
    const r=await createJourneyPlanner(db).search({fromStopId:'2397',toStopId:'35668',at:'2026-11-09T10:00:00Z',mode:'departure',marginSeconds:120,order:'arrival'})
    assert.equal(r.state,'no_journey');assert.deepEqual(r.itineraries,[])
  }finally{sqlite.close()}
})
for(const route of ['C13','C9','C16','125','T3'])test(`Tronçons et directions de ${route} réellement présents, sans forcer une correspondance`,{skip:!existsSync(path)},async()=>{
  const sqlite=new DatabaseSync(path,{readOnly:true})
  try{
    const sample=sqlite.prepare(`SELECT a.stop_id AS origin,b.stop_id AS destination FROM trips t JOIN stop_times a ON a.trip_id=t.id JOIN stop_times b ON b.trip_id=t.id AND b.sequence>a.sequence
      JOIN stops s ON s.id=a.stop_id JOIN stops d ON d.id=b.stop_id WHERE t.route_id=? AND a.departure BETWEEN 39600 AND 61200 AND a.pickup_type=0 AND b.drop_off_type=0
      AND (s.name='Place Henri' OR s.name LIKE 'Domr%Lacassagne' OR s.name LIKE 'Dauphin%Lacassagne') LIMIT 1`).get(route)
    assert.ok(sample)
    const metadata=JSON.parse(sqlite.prepare('SELECT json FROM metadata WHERE id=1').get().json)
    const low=Date.parse('2026-11-09T10:00:00Z'),high=low+21600000
    const legs=await scheduledLegs({all:async(sql,values=[])=>sqlite.prepare(sql).all(...values)},[{from:sample.origin,to:sample.destination,routes:[route]}],serviceDays(metadata,low,high),low,high)
    assert.ok(legs.length>0)
    for(const leg of legs){assert.equal(leg.routeId,route);assert.ok(leg.toSequence>leg.fromSequence);assert.ok(leg.arrival>=leg.departure)}
  }finally{sqlite.close()}
})
