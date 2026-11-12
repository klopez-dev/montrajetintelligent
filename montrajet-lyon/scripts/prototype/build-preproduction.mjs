import {build} from 'vite'
import react from '@vitejs/plugin-react'
import {DatabaseSync} from 'node:sqlite'
import {mkdir,readFile,writeFile,copyFile,readdir,stat} from 'node:fs/promises'
import {gzipSync,gunzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
const mapProvider=process.argv.includes('--qa-tile-provider')?'osm':'none'
const directory=resolve(process.argv[2]||'.data/hybrid-full-1794333824540'),output=resolve(`.data/preproduction-${Date.now()}`);await mkdir(output)
const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8')),db=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true})
try{
 const metadata=JSON.parse(db.prepare('SELECT json FROM metadata').get().json);if(metadata.sha256!==manifest.feedSha256)throw new Error('Versions GTFS différentes')
 const tripDates={},seen=new Set()
 for(const [date,day]of Object.entries(manifest.days)){if(seen.has(day.trips.file))continue;seen.add(day.trips.file);for(const t of JSON.parse(gunzipSync(await readFile(resolve(directory,day.trips.file)))))tripDates[t[0]]??=date}
 const directions=db.prepare('SELECT DISTINCT st.stop_id AS stopId,t.route_id AS lineId,t.direction_id AS id,t.headsign FROM stop_times st JOIN trips t ON t.id=st.trip_id ORDER BY t.direction_id,t.headsign,st.stop_id,t.route_id').all()
 const raw=Buffer.from(JSON.stringify({tripDates,directions})),compressed=gzipSync(raw),sha=createHash('sha256').update(compressed).digest('hex'),extra={file:sha+'.consultation.gz',sha256:sha,bytes:compressed.length,rawBytes:raw.length}
 if(raw.length>32000000)throw new Error('Catalogue supplémentaire trop grand')
 const replacements=new Map([['JourneyResults','JourneyResults.tsx'],['MobilityResults','MobilityResults.tsx'],['JourneyTraffic','JourneyTraffic.tsx']])
 const uxResults={name:'preproduction-results-only',enforce:'pre',resolveId(source,importer){
  if(!importer?.replaceAll('\\','/').endsWith('/src/components/JourneyForm.tsx'))return null
  const file=replacements.get(source.replace(/^\.\//,''))
  return file?resolve('experiments/preproduction/results',file):null
 }}
 await build({configFile:false,root:resolve('.'),plugins:[uxResults,react()],define:{'import.meta.env.VITE_MAP_PROVIDER':JSON.stringify(mapProvider)},worker:{format:'es'},build:{outDir:output,emptyOutDir:false,rollupOptions:{input:resolve('experiments/preproduction/index.html')}}})
 const target=resolve(output,'prototype-data');await mkdir(target)
 const files=new Set(['manifest.json','version.json',manifest.catalog.file,...Object.values(manifest.days).flatMap(d=>[d.file,d.trips.file])])
 for(const file of files)await copyFile(resolve(directory,file),resolve(target,file))
 await writeFile(resolve(target,extra.file),compressed,{flag:'wx'})
 await writeFile(resolve(output,'preproduction.json'),JSON.stringify({schema:1,feedSha256:manifest.feedSha256,extra,mode:'direct-ign',traffic:'unavailable'}),{flag:'wx'})
 const headers=`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: geolocation=(), camera=(), microphone=()\n  Content-Security-Policy: default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self' https://data.geopf.fr https://tile.openstreetmap.org; object-src 'none'; base-uri 'self'; frame-ancestors 'none'\n/prototype-data/*\n  Cache-Control: no-cache\n/preproduction.json\n  Cache-Control: no-store\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`
 await writeFile(resolve(output,'_headers'),headers,{flag:'wx'})
 const assets=[];for(const f of await readdir(output,{recursive:true,withFileTypes:true}))if(f.isFile())assets.push({file:resolve(f.parentPath,f.name).slice(output.length+1),bytes:(await stat(resolve(f.parentPath,f.name))).size})
 const report={output:output.slice(resolve('.').length+1).replaceAll('\\','/'),feedSha256:manifest.feedSha256,extra,tripLocators:Object.keys(tripDates).length,directions:directions.length,files:assets.length,bytes:assets.reduce((n,a)=>n+a.bytes,0),largest:Math.max(...assets.map(a=>a.bytes)),nodeRouteServer:false,sqliteInBrowser:false,mapProvider,assets}
 await writeFile(resolve(output,'build-report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report,null,2))
}finally{db.close()}
