import {DatabaseSync} from 'node:sqlite'
import {mkdir,writeFile,stat} from 'node:fs/promises'
import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {serviceActive,parseGtfsDate} from '../../server/gtfs/time.ts'
export function compileCatalog(db){
  return {metadata:JSON.parse(db.prepare('SELECT json FROM metadata WHERE id=1').get().json),stops:db.prepare('SELECT * FROM stops ORDER BY id').all(),routes:db.prepare('SELECT * FROM routes').all(),memberships:db.prepare('SELECT stop_id,route_id FROM route_stops').all(),transfers:db.prepare('SELECT * FROM transfers').all(),trips:db.prepare('SELECT id,route_id,service_id,direction_id,headsign FROM trips ORDER BY id').all().map(t=>[t.id,t.route_id,t.service_id,t.direction_id,t.headsign]),headsigns:db.prepare('SELECT DISTINCT headsign FROM stop_times ORDER BY headsign').all().map(r=>r.headsign)}
}
export function compileDay(db,catalog,date){
  parseGtfsDate(date.replaceAll('-',''))
  if(date<catalog.metadata.validFrom||date>catalog.metadata.validUntil)throw new Error('Date de compilation hors validité')
  const exceptions=new Map(db.prepare('SELECT service_id,exception_type FROM calendar_dates WHERE date=?').all(date).map(e=>[e.service_id,e.exception_type]))
  const active=new Set(db.prepare('SELECT * FROM services').all().filter(s=>serviceActive({id:s.id,startDate:s.start_date,endDate:s.end_date,weekdays:['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(k=>s[k])},date,exceptions.get(s.id))).map(s=>s.id))
  const trips=new Map(catalog.trips.map((t,i)=>[t[0],i])),stops=new Map(catalog.stops.map((s,i)=>[s.id,i])),headsigns=new Map(catalog.headsigns.map((h,i)=>[h,i]))
  const rows=db.prepare('SELECT st.* FROM stop_times st JOIN trips t ON t.id=st.trip_id WHERE t.service_id IN (SELECT value FROM json_each(?)) ORDER BY st.trip_id,st.sequence').all(JSON.stringify([...active]))
  const buffer=Buffer.alloc(rows.length*28)
  rows.forEach((r,i)=>{
    const values=[trips.get(r.trip_id),stops.get(r.stop_id),r.sequence,r.arrival??0xffffffff,r.departure??0xffffffff,headsigns.get(r.headsign),r.pickup_type|(r.drop_off_type<<8)|(r.timepoint<<16)]
    if(values.some(v=>!Number.isInteger(v)||v<0||v>0xffffffff))throw new Error('Valeur non encodable, compilation refusée')
    values.forEach((v,j)=>buffer.writeUInt32LE(v,i*28+j*4))
  })
  return buffer
}
export async function compilePackage(db,directory,dates){
  await mkdir(directory)
  const catalog=compileCatalog(db),manifest={format:1,feedSha256:catalog.metadata.sha256,catalog:null,days:{},note:'Prototype local uniquement. Aucun fichier source remplacé, aucun déploiement.'}
  async function asset(file,raw){const data=gzipSync(raw);await writeFile(resolve(directory,file),data,{flag:'wx'});return{file,bytes:data.length,rawBytes:raw.length,sha256:createHash('sha256').update(data).digest('hex')}}
  manifest.catalog=await asset('catalog.json.gz',Buffer.from(JSON.stringify(catalog)))
  for(const date of dates){const binary=compileDay(db,catalog,date);manifest.days[date]={...await asset(date+'.bin.gz',binary),records:binary.length/28}}
  await writeFile(resolve(directory,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});return manifest
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const directory=resolve(`.data/hybrid-static-${Date.now()}`),db=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),started=performance.now()
 try{const manifest=await compilePackage(db,directory,['2026-11-08','2026-11-09','2026-11-10']);console.log(JSON.stringify({directory,manifest,compileMs:performance.now()-started,sqliteBytes:(await stat('.data/gtfs.sqlite')).size}))}finally{db.close()}
}
