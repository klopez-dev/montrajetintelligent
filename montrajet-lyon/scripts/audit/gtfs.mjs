import {DatabaseSync} from 'node:sqlite'
import {stat,writeFile} from 'node:fs/promises'
import {createGzip,gzipSync} from 'node:zlib'
import {Readable,Writable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {createHash} from 'node:crypto'
import {serviceActive} from '../../server/gtfs/time.ts'
import {cpuMs,freeD1WriteDays} from './metrics.mjs'

const start=performance.now(),cpu=process.cpuUsage(),before=process.memoryUsage(),d=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),openMs=performance.now()-start
try{
  const metadata=JSON.parse(d.prepare('SELECT json FROM metadata WHERE id=1').get().json),tables=d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
  const objects=d.prepare('SELECT name,sum(pgsize) bytes,sum(payload) payloadBytes,sum(unused) unusedBytes FROM dbstat GROUP BY name ORDER BY bytes DESC').all()
  const indexes=new Set(d.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r=>r.name))
  const counts=Object.fromEntries(tables.map(t=>[t.name,d.prepare(`SELECT count(*) n FROM "${t.name}"`).get().n]))
  const stops=d.prepare('SELECT * FROM stops ORDER BY id').all(),trips=d.prepare('SELECT * FROM trips ORDER BY id').all(),services=d.prepare('SELECT * FROM services').all(),exceptions=d.prepare('SELECT * FROM calendar_dates').all()
  const date='2026-11-09',exceptionMap=new Map(exceptions.filter(e=>e.date===date).map(e=>[e.service_id,e.exception_type]))
  const activeServices=new Set(services.filter(s=>serviceActive({id:s.id,startDate:s.start_date,endDate:s.end_date,weekdays:['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(k=>s[k])},date,exceptionMap.get(s.id))).map(s=>s.id))
  const tripMap=new Map(trips.map((t,i)=>[t.id,i])),stopMap=new Map(stops.map((s,i)=>[s.id,i])),activeTripIndices=new Set(trips.flatMap((t,i)=>activeServices.has(t.service_id)?[i]:[])),headsigns=new Map()
  async function measureBinary(activeOnly){
    let count=0,bytes=0,gzipBytes=0;const hash=createHash('sha256')
    async function* chunks(){
      let buffer=Buffer.alloc(28*4096),offset=0
      for(const row of d.prepare('SELECT * FROM stop_times').iterate()){
        const trip=tripMap.get(row.trip_id),stop=stopMap.get(row.stop_id)
        if(activeOnly&&!activeTripIndices.has(trip))continue
        if(trip===undefined||stop===undefined)throw new Error('Broken official reference')
        if(!headsigns.has(row.headsign))headsigns.set(row.headsign,headsigns.size)
        buffer.writeUInt32LE(trip,offset);buffer.writeUInt32LE(stop,offset+4);buffer.writeUInt32LE(row.sequence,offset+8);buffer.writeInt32LE(row.arrival??-1,offset+12);buffer.writeInt32LE(row.departure??-1,offset+16);buffer.writeUInt32LE(headsigns.get(row.headsign),offset+20);buffer[offset+24]=row.pickup_type;buffer[offset+25]=row.drop_off_type;buffer[offset+26]=row.timepoint
        offset+=28;count++
        if(offset===buffer.length){bytes+=offset;yield buffer;buffer=Buffer.alloc(28*4096);offset=0}
      }
      if(offset){bytes+=offset;yield buffer.subarray(0,offset)}
    }
    const at=performance.now(),c=process.cpuUsage()
    await pipeline(Readable.from(chunks()),createGzip({level:6}),new Writable({write(chunk,_,done){gzipBytes+=chunk.length;hash.update(chunk);done()}}))
    return {records:count,rawBytes:bytes,gzipBytes,gzipSha256:hash.digest('hex'),wallMs:performance.now()-at,cpuMs:cpuMs(process.cpuUsage(c))}
  }
  // A size probe only. No route engine, data publication, or production binary is created.
  const allFeed=await measureBinary(false),oneServiceDay=await measureBinary(true)
  const names=['agency','routes','stops','trips','services','calendar_dates','transfers']
  const dictionary={metadata,headsigns:[...headsigns.keys()]}
  for(const name of names){const cols=d.prepare(`PRAGMA table_info("${name}")`).all().map(c=>c.name);dictionary[name]={columns:cols,rows:d.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(r=>cols.map(c=>r[c]))}}
  // Trip/stop binary indexes use ORDER BY id; record that explicitly, not incidental rowid order.
  for(const name of ['trips','stops']){const cols=dictionary[name].columns;dictionary[name].rows=(name==='trips'?trips:stops).map(r=>cols.map(c=>r[c]))}
  const dictionaryRaw=JSON.stringify(dictionary),dictionaryBytes=Buffer.byteLength(dictionaryRaw),dictionaryGzipBytes=gzipSync(dictionaryRaw).length
  const [archive,database]=await Promise.all([stat('GTFS_TCL.ZIP'),stat('.data/gtfs.sqlite')])
  const report={checkedAt:new Date().toISOString(),metadata,archiveBytes:archive.size,sqliteBytes:database.size,openMs,counts,objects,indexBytes:objects.filter(o=>indexes.has(o.name)).reduce((s,o)=>s+o.bytes,0),minimumD1WriteDaysWithoutIndexes:freeD1WriteDays(Object.values(counts).reduce((a,b)=>a+b,0)),sizePrototype:{recordBytes:28,allFeed,oneServiceDay:{date,activeTrips:activeTripIndices.size,...oneServiceDay},dictionaryBytes,dictionaryGzipBytes,note:'Size-only binary probe, no production format or planner. Full dictionaries include all feed trips; day/route sharding and correctness remain unimplemented.'},totalWallMs:performance.now()-start,totalCpuMs:cpuMs(process.cpuUsage(cpu)),memoryBefore:before,memoryAfter:process.memoryUsage(),maxRssKiB:process.resourceUsage().maxRSS}
  const output=`.data/cost-audit-gtfs-${Date.now()}.json`;await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(output);console.log(JSON.stringify({counts,indexBytes:report.indexBytes,prototype:report.sizePrototype,totalWallMs:report.totalWallMs,maxRssKiB:report.maxRssKiB}))
}finally{d.close()}
