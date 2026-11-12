import test from 'node:test'
import assert from 'node:assert/strict'
import { routingDatabase, query } from './helpers/journeys.mjs'
import { createNetworkPlanner } from '../server/journeys/network.ts'
import { defaultRoutingLimits, routingLimits } from '../server/journeys/limits.ts'

async function chain(changes={}){
  const f=await routingDatabase()
  f.sqlite.prepare('INSERT INTO stops VALUES(?,?,?,?,?,?,?,?)').run('E','TEST E','','','',45,4,0)
  const shift=changes.shift||0
  f.trip('BUS1','BUS',[['O',39600+shift],['X',40000+shift]],changes.service||'DAILY')
  f.trip('TRAM1','TRAM',[['Y',40300+shift],['Z',40700+shift]],changes.service||'DAILY')
  f.trip('METRO1','METRO',[['E',41000+shift],['D',41600+shift]],changes.service||'DAILY')
  f.transfer();f.transfer({from:'Z',to:'E'})
  return f
}
function audit(sqlite,result){
  for(const journey of result.itineraries){
    assert.equal(journey.connections.length,journey.legs.length-1)
    for(const leg of journey.legs){
      const a=sqlite.prepare('SELECT * FROM stop_times WHERE trip_id=? AND sequence=?').get(leg.tripId,leg.from.sequence)
      const b=sqlite.prepare('SELECT * FROM stop_times WHERE trip_id=? AND sequence=?').get(leg.tripId,leg.to.sequence)
      assert.equal(a.stop_id,leg.from.id);assert.equal(b.stop_id,leg.to.id);assert.ok(a.sequence<b.sequence)
      assert.equal(a.departure,leg.departureGtfsSeconds);assert.equal(b.arrival,leg.arrivalGtfsSeconds);assert.equal(a.pickup_type,0);assert.equal(b.drop_off_type,0)
    }
    journey.connections.forEach((connection,index)=>{
      const rule=sqlite.prepare('SELECT * FROM transfers WHERE id=?').get(connection.ruleId)
      assert.equal(rule.from_stop_id,connection.fromStopId);assert.equal(rule.to_stop_id,connection.toStopId)
      assert.equal(connection.requiredSeconds,Math.max(rule.min_transfer_time,connection.walkingSeconds || 0)+result.query.marginSeconds)
      assert.equal(connection.intervalSeconds,(Date.parse(journey.legs[index+1].departureTime)-Date.parse(journey.legs[index].arrivalTime))/1000)
      assert.ok(connection.intervalSeconds>=connection.requiredSeconds)
    })
  }
}
test('Trois véhicules / deux correspondances officielles exactes, aller et arriver avant',async()=>{
  const f=await chain();try{
    const planner=createNetworkPlanner(f.db)
    for(const mode of ['departure','arrival']){
      const r=await planner.search(query({maxTransfers:2,mode,at:mode==='arrival'?'2026-11-09T10:33:20Z':'2026-11-09T10:00:00Z'}))
      assert.equal(r.state,'ok');assert.equal(r.itineraries[0].transfers,2);assert.equal(r.metrics.rounds,3);audit(f.sqlite,r)
    }
    assert.equal((await planner.search(query({maxTransfers:1}))).state,'no_journey')
    assert.equal((await planner.search(query({maxTransfers:2,marginSeconds:121}))).state,'no_journey')
    assert.equal((await planner.search(query({maxTransfers:2,mode:'arrival',at:'2026-11-09T10:33:19Z'}))).state,'no_journey')
  }finally{f.close()}
})
test('Deuxième transfert interdit ou inverse : aucun trajet construit',async()=>{
  for(const kind of ['forbidden','inverse']){
    const f=await chain();try{
      if(kind==='forbidden')f.transfer({from:'Z',to:'E',type:3,seconds:null,fromTrip:'TRAM1',toTrip:'METRO1'})
      else f.sqlite.exec("UPDATE transfers SET from_stop_id='E',to_stop_id='Z' WHERE from_stop_id='Z'")
      assert.equal((await createNetworkPlanner(f.db).search(query({maxTransfers:2}))).state,'no_journey')
    }finally{f.close()}
  }
})
test('Deux correspondances après minuit rattachées au jour de service précédent',async()=>{
  const f=await chain({shift:50400});try{
    const r=await createNetworkPlanner(f.db).search(query({maxTransfers:2,at:'2026-11-10T00:00:00Z'}))
    assert.equal(r.state,'ok');assert.equal(r.itineraries[0].legs[0].serviceDate,'2026-11-09');assert.equal(r.itineraries[0].legs[0].departureGtfsSeconds,90000);audit(f.sqlite,r)
  }finally{f.close()}
})
test('Calendriers et exceptions contrôlés à chaque véhicule, pas seulement au premier',async()=>{
  const f=await chain();try{
    f.sqlite.exec("UPDATE trips SET service_id='EXCEPTIONS' WHERE id='TRAM1'")
    assert.equal((await createNetworkPlanner(f.db).search(query({maxTransfers:2}))).state,'no_journey')
    f.sqlite.exec("INSERT INTO calendar_dates VALUES('EXCEPTIONS','2026-11-09',1)")
    assert.equal((await createNetworkPlanner(f.db).search(query({maxTransfers:2}))).state,'ok')
  }finally{f.close()}
})
test('Changements d’heure : durées absolues et services cohérents dans les deux sens',async()=>{
  for(const [date,at]of[['2026-03-29','2026-03-29T00:00:00Z'],['2026-10-25','2026-10-25T00:00:00Z']]){
    const f=await chain({shift:-30600});try{
      const r=await createNetworkPlanner(f.db).search(query({maxTransfers:2,at}))
      assert.equal(r.state,'ok');const j=r.itineraries[0];assert.equal(j.durationSeconds,2000);assert.ok(j.legs.every(l=>l.serviceDate===date))
      const reverse=await createNetworkPlanner(f.db).search(query({maxTransfers:2,mode:'arrival',at:j.arrivalTime}))
      assert.equal(reverse.state,'ok');assert.equal(reverse.itineraries[0].departureTime,j.departureTime)
    }finally{f.close()}
  }
})
test('Cache de calcul : paramètres, marges et sens isolés, même résultat contrôlé',async()=>{
  const f=await chain();try{
    const planner=createNetworkPlanner(f.db),q=query({maxTransfers:2})
    const first=await planner.search(q),second=await planner.search(q)
    assert.equal(second.metrics.cacheHit,true);assert.equal(second.metrics.sqlQueries,1);assert.deepEqual(first.itineraries,second.itineraries)
    assert.equal((await planner.search({...q,marginSeconds:121})).state,'no_journey')
  }finally{f.close()}
})
test('Budgets configurables : lot incomplet refusé et état limité, annulation propagée',async()=>{
  const f=await chain();try{
    const planner=createNetworkPlanner(f.db,{...defaultRoutingLimits,maxEvents:1})
    const r=await planner.search(query({maxTransfers:2}));assert.equal(r.state,'limited');assert.equal(r.itineraries.length,0)
    await assert.rejects(()=>createNetworkPlanner(f.db).search(query({maxTransfers:2}),[],undefined,AbortSignal.abort()))
    assert.equal(routingLimits({ROUTING_MAX_EVENTS:'5000'}).maxEvents,5000)
    assert.throws(()=>routingLimits({ROUTING_MAX_EVENTS:'-1'}))
  }finally{f.close()}
})
