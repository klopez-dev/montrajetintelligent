import {DatabaseSync} from 'node:sqlite'
import {mkdir,writeFile} from 'node:fs/promises'
import {createReadStream} from 'node:fs'
import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {serviceActive,addDays} from '../../server/gtfs/time.ts'
import {compileCatalog,compileDay} from './compile.mjs'
import {pathToFileURL} from 'node:url'
export async function compileFull(db,directory,progress=()=>{}){
 await mkdir(directory)
 const full=compileCatalog(db),catalog={...full,trips:[]},manifest={format:2,feedSha256:full.metadata.sha256,catalog:null,days:{},note:'Complete local calendar compilation, content-addressed deduplicated assets; no deployment.'}
 const written=new Map(),patterns=new Map(),report={days:[],patterns:0,uniqueAssets:0,compressedBytes:0,sourceMetadata:full.metadata}
 async function asset(kind,raw){const data=gzipSync(raw),hash=createHash('sha256').update(data).digest('hex'),file=hash+'.'+kind+'.gz';if(!written.has(file)){await writeFile(resolve(directory,file),data,{flag:'wx'});written.set(file,{file,sha256:hash,bytes:data.length,rawBytes:raw.length})}return written.get(file)}
 manifest.catalog=await asset('catalog',Buffer.from(JSON.stringify(catalog)))
 const services=db.prepare('SELECT * FROM services ORDER BY id').all(),exceptions=new Map()
 for(const row of db.prepare('SELECT * FROM calendar_dates ORDER BY date,service_id').all()){if(!exceptions.has(row.date))exceptions.set(row.date,new Map());exceptions.get(row.date).set(row.service_id,row.exception_type)}
 for(let date=full.metadata.validFrom;date<=full.metadata.validUntil;date=addDays(date,1)){
  const started=performance.now(),active=services.filter(s=>serviceActive({id:s.id,startDate:s.start_date,endDate:s.end_date,weekdays:['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(k=>s[k])},date,exceptions.get(date)?.get(s.id))).map(s=>s.id),key=JSON.stringify(active)
  let packet=patterns.get(key)
  if(!packet){
   const binary=compileDay(db,full,date),tripIds=[];let last=-1
   for(let i=0;i<binary.length;i+=28){const id=binary.readUInt32LE(i);if(id!==last){tripIds.push(id);last=id}}
   const remap=new Map(tripIds.map((id,i)=>[id,i]));for(let i=0;i<binary.length;i+=28)binary.writeUInt32LE(remap.get(binary.readUInt32LE(i)),i)
   packet={...await asset('events',binary),records:binary.length/28,trips:await asset('trips',Buffer.from(JSON.stringify(tripIds.map(id=>full.trips[id]))))};patterns.set(key,packet)
  }
  manifest.days[date]=packet;report.days.push({date,activeServices:active.length,records:packet.records,compressedBytes:packet.bytes+packet.trips.bytes,ms:performance.now()-started});progress(report.days.at(-1))
 }
 const json=JSON.stringify(manifest,null,2),version=createHash('sha256').update(json).digest('hex');await writeFile(resolve(directory,'manifest.json'),json,{flag:'wx'})
 await writeFile(resolve(directory,'version.json'),JSON.stringify({schema:2,manifestSha256:version,feedSha256:manifest.feedSha256,validFrom:full.metadata.validFrom,validUntil:full.metadata.validUntil}),{flag:'wx'})
 report.patterns=patterns.size;report.uniqueAssets=written.size;report.compressedBytes=[...written.values()].reduce((n,a)=>n+a.bytes,0);report.unduplicatedDayReferencesBytes=report.days.reduce((n,d)=>n+d.compressedBytes,0);report.version=version
 await writeFile(resolve(directory,'coverage.json'),JSON.stringify(report,null,2),{flag:'wx'});return{manifest,report}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const started=performance.now(),directory=resolve(`.data/hybrid-full-${Date.now()}`),db=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true})
 try{const metadata=JSON.parse(db.prepare('SELECT json FROM metadata').get().json),hash=createHash('sha256');for await(const chunk of createReadStream('GTFS_TCL.ZIP'))hash.update(chunk);if(hash.digest('hex')!==metadata.sha256)throw new Error('Archive locale et import GTFS différents');const result=await compileFull(db,directory,d=>console.log(JSON.stringify(d)));console.log(JSON.stringify({directory,compileMs:performance.now()-started,patterns:result.report.patterns,compressedBytes:result.report.compressedBytes}))}finally{db.close()}
}
