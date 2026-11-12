import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

export const query = (changes={}) => ({fromStopId:'O',toStopId:'D',at:'2026-11-09T10:00:00Z',mode:'departure',marginSeconds:120,order:'arrival',...changes})
// Fixtures isolées exclusivement destinées aux tests, jamais à la base TCL.
export async function routingDatabase() {
  const sqlite=new DatabaseSync(':memory:')
  sqlite.exec(await readFile(new URL('../../server/gtfs/schema.sql',import.meta.url),'utf8'))
  sqlite.exec(`INSERT INTO agency VALUES('TEST','TEST','https://example.org','Europe/Paris');
    INSERT INTO routes VALUES('BUS','TEST','TEST BUS','TEST BUS',3),('TRAM','TEST','TEST TRAM','TEST TRAM',0),('METRO','TEST','TEST METRO','TEST METRO',1),('FUNICULAR','TEST','TEST FUNICULAR','TEST FUNICULAR',7);
    INSERT INTO stops VALUES('O','TEST ORIGIN','','','',45,4,0),('X','TEST CONNECTION','','','',45,4,0),('Y','TEST CONNECTION','','','',45,4,0),('D','TEST DESTINATION','','','',45,4,0),('Z','TEST ISOLATED','','','',45,4,0);
    INSERT INTO services VALUES('DAILY','2026-01-01','2026-12-31',1,1,1,1,1,1,1);
    INSERT INTO services VALUES('WEEKDAYS','2026-01-01','2026-12-31',1,1,1,1,1,0,0);
    INSERT INTO services(id) VALUES('EXCEPTIONS');`)
  sqlite.prepare('INSERT INTO metadata VALUES(1,?)').run(JSON.stringify({schemaVersion:1,timezone:'Europe/Paris',validFrom:'2026-01-01',validUntil:'2026-12-31',maxDepartureSeconds:180000,files:{},warnings:[],importedAt:'2026-11-01T00:00:00Z',sha256:'TEST',sourceUrl:'https://example.org'}))
  const db={all:async(sql,params=[])=>sqlite.prepare(sql).all(...params)}
  function trip(id,route,stops,service='DAILY',options={}) {
    sqlite.prepare('INSERT INTO trips VALUES(?,?,?,?,?)').run(id,route,service,options.direction||'0','TEST DESTINATION')
    stops.forEach(([stop,seconds],index)=>{
      sqlite.prepare('INSERT INTO stop_times VALUES(?,?,?,?,?,?,?,?,?)').run(id,stop,index+1,seconds,seconds,'',options.pickup??0,options.dropoff??0,1)
      sqlite.prepare('INSERT OR IGNORE INTO route_stops VALUES(?,?)').run(route,stop)
    })
  }
  function transfer(changes={}) {
    const r={from:'X',to:'Y',type:2,seconds:180,fromRoute:null,toRoute:null,fromTrip:null,toTrip:null,...changes}
    sqlite.prepare('INSERT INTO transfers(from_stop_id,to_stop_id,from_route_id,to_route_id,from_trip_id,to_trip_id,transfer_type,min_transfer_time) VALUES(?,?,?,?,?,?,?,?)').run(r.from,r.to,r.fromRoute,r.toRoute,r.fromTrip,r.toTrip,r.type,r.seconds)
  }
  function connection(options={}) {
    trip('B1','BUS',[['O',39600],['X',40200]],options.service||'DAILY')
    trip('T1','TRAM',[[options.samePlatform?'X':'Y',40500],['D',41400]],options.service||'DAILY')
    if(!options.noTransfer && !options.samePlatform)transfer()
  }
  return {db,sqlite,trip,transfer,connection,close:()=>sqlite.close()}
}

/** Oracle indépendant : conversion par offset de midi, calendriers lus directement.
 * Ne réutilise ni planner.ts, ni schedules.ts, ni transferPolicy().
 */
export function auditJourney(sqlite,result,journey) {
  assert.ok(journey.kind==='theoretical')
  assert.equal(journey.legs[0].from.id,result.query.fromStopId)
  assert.equal(journey.legs.at(-1).to.id,result.query.toStopId)
  assert.equal(journey.transfers,journey.legs.length-1)
  let prior=null,index=0
  const connections=journey.connections??(journey.connection?[journey.connection]:[])
  assert.equal(connections.length,journey.legs.length-1)
  for(const leg of journey.legs){
    const a=sqlite.prepare('SELECT * FROM stop_times WHERE trip_id=? AND sequence=? AND stop_id=?').get(leg.tripId,leg.from.sequence,leg.from.id)
    const b=sqlite.prepare('SELECT * FROM stop_times WHERE trip_id=? AND sequence=? AND stop_id=?').get(leg.tripId,leg.to.sequence,leg.to.id)
    assert.ok(a&&b);assert.ok(a.sequence<b.sequence);assert.equal(a.pickup_type,0);assert.equal(b.drop_off_type,0)
    const trip=sqlite.prepare('SELECT * FROM trips WHERE id=?').get(leg.tripId)
    assert.equal(trip.route_id,leg.routeId);assert.equal(trip.direction_id,leg.directionId);assert.equal(a.headsign||trip.headsign,leg.headsign)
    const service=sqlite.prepare('SELECT * FROM services WHERE id=?').get(trip.service_id)
    const exception=sqlite.prepare('SELECT exception_type FROM calendar_dates WHERE service_id=? AND date=?').get(trip.service_id,leg.serviceDate)
    const weekday=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(`${leg.serviceDate}T12:00:00Z`).getUTCDay()]
    assert.ok(exception?exception.exception_type===1:leg.serviceDate>=service.start_date&&leg.serviceDate<=service.end_date&&service[weekday]===1)
    const noon=Date.parse(`${leg.serviceDate}T12:00:00Z`)
    const hours=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',hour:'2-digit',hourCycle:'h23'}).format(noon))
    const origin=noon-(hours-12)*3600000-12*3600000
    assert.equal(Date.parse(leg.departureTime),origin+a.departure*1000)
    assert.equal(Date.parse(leg.arrivalTime),origin+b.arrival*1000)
    assert.equal(leg.departureGtfsSeconds,a.departure);assert.equal(leg.arrivalGtfsSeconds,b.arrival)
    assert.ok(Date.parse(leg.arrivalTime)>=Date.parse(leg.departureTime))
    if(prior)assert.ok(Date.parse(leg.departureTime)>=Date.parse(prior.arrivalTime)+connections[index-1].requiredSeconds*1000)
    prior=leg;index++
  }
  assert.equal(journey.durationSeconds,(Date.parse(journey.arrivalTime)-Date.parse(journey.departureTime))/1000)
  assert.ok(Date.parse(journey.departureTime)>=Date.parse(result.scope.from))
  assert.ok(Date.parse(journey.arrivalTime)<=Date.parse(result.scope.until))
  for(const [index,c] of connections.entries()){
    if(c.source==='gtfs'){
      const rule=sqlite.prepare('SELECT * FROM transfers WHERE id=?').get(c.ruleId)
      assert.ok(rule);assert.equal(rule.transfer_type,2)
      assert.ok(rule.from_stop_id===c.fromStopId || sqlite.prepare('SELECT parent_id FROM stops WHERE id=?').get(c.fromStopId).parent_id===rule.from_stop_id)
      assert.ok(rule.to_stop_id===c.toStopId || sqlite.prepare('SELECT parent_id FROM stops WHERE id=?').get(c.toStopId).parent_id===rule.to_stop_id)
      assert.equal(c.officialMinimumSeconds,rule.min_transfer_time)
    }else if(c.source==='ign_pedestrian'){
      assert.ok(c.walkingPath);assert.equal(c.walkingPath.profile,'pedestrian');assert.equal(c.walkingSeconds,c.walkingPath.durationSeconds)
      assert.ok(c.walkingPath.startSnapMeters<=25&&c.walkingPath.endSnapMeters<=25)
      assert.ok(c.walkingPath.geometry.coordinates.length>=2)
    }else{assert.equal(c.fromStopId,c.toStopId);assert.equal(c.walkingSeconds,0)}
    assert.equal(c.requiredSeconds,Math.max(c.officialMinimumSeconds,c.walkingSeconds || 0)+result.query.marginSeconds)
    assert.equal(c.fromStopId,journey.legs[index].to.id);assert.equal(c.toStopId,journey.legs[index+1].from.id)
    assert.equal(c.intervalSeconds,(Date.parse(journey.legs[index+1].departureTime)-Date.parse(journey.legs[index].arrivalTime))/1000)
    assert.ok(c.intervalSeconds>=c.requiredSeconds)
  }
}
