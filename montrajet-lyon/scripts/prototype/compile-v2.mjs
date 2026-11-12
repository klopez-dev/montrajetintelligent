import {DatabaseSync} from 'node:sqlite'
import {mkdir,writeFile} from 'node:fs/promises'
import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {compileCatalog,compileDay} from './compile.mjs'

export async function compileV2(db,directory,dates){
 await mkdir(directory)
 const full=compileCatalog(db),catalog={...full,trips:[]},manifest={format:2,feedSha256:full.metadata.sha256,catalog:null,days:{},note:'Local experimental package; version identified by manifest SHA-256. No active migration.'}
 async function asset(file,raw){const data=gzipSync(raw);await writeFile(resolve(directory,file),data,{flag:'wx'});return{file,bytes:data.length,rawBytes:raw.length,sha256:createHash('sha256').update(data).digest('hex')}}
 manifest.catalog=await asset('catalog.json.gz',Buffer.from(JSON.stringify(catalog)))
 for(const date of dates){
  const binary=compileDay(db,full,date),tripIds=[];let last=-1
  for(let i=0;i<binary.length;i+=28){const id=binary.readUInt32LE(i);if(id!==last){tripIds.push(id);last=id}}
  const remap=new Map(tripIds.map((id,i)=>[id,i]))
  for(let i=0;i<binary.length;i+=28)binary.writeUInt32LE(remap.get(binary.readUInt32LE(i)),i)
  const trips=await asset(date+'.trips.json.gz',Buffer.from(JSON.stringify(tripIds.map(id=>full.trips[id]))))
  manifest.days[date]={...await asset(date+'.bin.gz',binary),records:binary.length/28,trips}
 }
 const json=JSON.stringify(manifest,null,2)
 await writeFile(resolve(directory,'manifest.json'),json,{flag:'wx'})
 await writeFile(resolve(directory,'version.json'),JSON.stringify({schema:2,manifestSha256:createHash('sha256').update(json).digest('hex'),feedSha256:manifest.feedSha256,validFrom:full.metadata.validFrom,validUntil:full.metadata.validUntil}),{flag:'wx'})
 return manifest
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const directory=resolve(`.data/hybrid-v2-${Date.now()}`),db=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),started=performance.now()
 try{const dates=process.argv.slice(2);const manifest=await compileV2(db,directory,dates.length?dates:['2026-11-08','2026-11-09','2026-11-10','2026-11-11','2026-11-12']);console.log(JSON.stringify({directory,compileMs:performance.now()-started,manifest}))}finally{db.close()}
}
