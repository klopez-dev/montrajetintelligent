import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {loadStaticDatabase} from '../../experiments/hybrid/load.ts'
import {createJourneyPlanner} from '../../server/journeys/planner.ts'
import {auditJourney} from '../../tests/helpers/journeys.mjs'
import {addDays} from '../../server/gtfs/time.ts'
const directory=resolve(process.argv[2]||''),output=resolve(`.data/hybrid-full-validation-${Date.now()}`);await mkdir(output)
const sqlite=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),db={all:async(s,p=[])=>sqlite.prepare(s).all(...p)},manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8')),report={coverage:[],cases:[],divergences:[],notes:['All manifest service dates checked independently in SQLite. Itinerary matrix is sampled, not all stop pairs.','No real DST transition occurs within this feed validity; fixtures cover DST separately.']}
const canonical=r=>({state:r.state,itineraries:r.itineraries,scope:r.scope,warnings:r.warnings}),counts=new Map()
try{
 const metadata=JSON.parse(sqlite.prepare('SELECT json FROM metadata').get().json)
 const select=sqlite.prepare(`SELECT s.id FROM services s LEFT JOIN calendar_dates c ON c.service_id=s.id AND c.date=? WHERE CASE WHEN c.exception_type IS NOT NULL THEN c.exception_type=1 ELSE ? BETWEEN s.start_date AND s.end_date AND CASE CAST(strftime('%w',?) AS INTEGER) WHEN 0 THEN s.sunday WHEN 1 THEN s.monday WHEN 2 THEN s.tuesday WHEN 3 THEN s.wednesday WHEN 4 THEN s.thursday WHEN 5 THEN s.friday ELSE s.saturday END=1 END ORDER BY s.id`)
 const count=sqlite.prepare('SELECT count(*) AS n FROM stop_times st JOIN trips t ON t.id=st.trip_id WHERE t.service_id IN (SELECT value FROM json_each(?))')
 const stat=await loadStaticDatabase(manifest,f=>readFile(resolve(directory,f)))
 for(let date=metadata.validFrom;date<=metadata.validUntil;date=addDays(date,1)){
  assert.ok(manifest.days[date],'Missing compiled calendar day '+date)
  const active=select.all(date,date,date).map(r=>r.id),key=JSON.stringify(active);if(!counts.has(key))counts.set(key,count.get(key).n)
  assert.equal(manifest.days[date].records,counts.get(key),'Source event count mismatch '+date)
  const packet=await stat.packet(date);assert.equal(packet.data.length/7,counts.get(key));report.coverage.push({date,activeServices:active.length,events:packet.data.length/7})
 }
 const sqlPlanner=createJourneyPlanner(db),staticPlanner=createJourneyPlanner(stat)
 const days=['2026-11-08','2026-11-09','2026-11-11','2026-12-25','2027-01-01','2027-02-15','2027-03-08'],routes=[['direct','35660','35668'],['one','2397','36394'],['two','1138','36394']]
 for(const date of days)for(const [name,fromStopId,toStopId]of routes)for(const maxTransfers of [1,2]){
  const query={fromStopId,toStopId,at:date+'T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:120,maxTransfers},a=await sqlPlanner.search(query),b=await staticPlanner.search(query),equal=JSON.stringify(canonical(a))===JSON.stringify(canonical(b))
  for(const journey of b.itineraries)auditJourney(sqlite,b,journey)
  if(!equal)report.divergences.push({query,reference:canonical(a),actual:canonical(b)})
  report.cases.push({name,query,equal,state:b.state,proposals:b.itineraries.length});console.log(date,name,maxTransfers,equal,b.state)
 }
 for(const extra of [{at:'2026-11-09T23:05:00Z'},{mode:'arrival',order:'departure',at:'2026-11-09T11:00:00Z'},{marginSeconds:600},{fromStopId:'35668',toStopId:'35660'},{at:'2028-01-01T10:00:00Z'}]){
  const query={fromStopId:'35660',toStopId:'35668',at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:120,maxTransfers:2,...extra},a=await sqlPlanner.search(query),b=await staticPlanner.search(query),equal=JSON.stringify(canonical(a))===JSON.stringify(canonical(b));if(!equal)report.divergences.push({query,reference:canonical(a),actual:canonical(b)});for(const journey of b.itineraries)auditJourney(sqlite,b,journey);report.cases.push({name:'extra',query,equal,state:b.state,proposals:b.itineraries.length})
 }
 report.status=report.divergences.length?'divergent':'passed';if(report.divergences.length)process.exitCode=1
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;console.error(e)}finally{sqlite.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
