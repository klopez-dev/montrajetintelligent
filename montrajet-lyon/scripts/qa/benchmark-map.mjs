import { DatabaseSync } from 'node:sqlite'
import { readFile, writeFile } from 'node:fs/promises'
import { handleMapRequest } from '../../server/maps/api.ts'

// Read-only benchmark. No provider/network request and no replacement of past evidence.
const sqlite=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),report=[]
try{
  const metadata=JSON.parse(sqlite.prepare('SELECT json FROM metadata WHERE id=1').get().json)
  let catalog=null;try{catalog=JSON.parse(await readFile('.data/map-catalog.json','utf8'))}catch{/* Optional colors. */}
  const db={all:async(sql,params=[])=>sqlite.prepare(sql).all(...params)}
  for(const line of ['T3','C13','C9','C16','125']){
    const trip=sqlite.prepare('SELECT t.id FROM trips t JOIN routes r ON r.id=t.route_id WHERE r.short_name=? LIMIT 1').get(line)
    if(!trip){report.push({line,state:'not_found'});continue}
    const stops=sqlite.prepare('SELECT stop_id,sequence FROM stop_times WHERE trip_id=? ORDER BY sequence').all(trip.id)
    if(stops.length<2){report.push({line,state:'insufficient_stops'});continue}
    const runs=[]
    for(let repeat=0;repeat<6;repeat++){
      const start=performance.now(),response=await handleMapRequest(new Request('http://local/api/maps',{method:'POST',body:JSON.stringify({feedSha256:metadata.sha256,legs:[{tripId:trip.id,fromStopId:stops[0].stop_id,toStopId:stops.at(-1).stop_id,fromSequence:stops[0].sequence,toSequence:stops.at(-1).sequence}]})}),db,catalog)
      const text=await response.text();if(!response.ok)throw new Error(text)
      runs.push({ms:performance.now()-start,sqlAndAssemblyMs:JSON.parse(text).durationMs,bytes:Buffer.byteLength(text)})
    }
    report.push({line,stops:stops.length,runs})
  }
  const path=`.data/map-api-benchmark-${Date.now()}.json`;await writeFile(path,JSON.stringify({feedSha256:metadata.sha256,report},null,2),{flag:'wx'});console.log(path)
}finally{sqlite.close()}
