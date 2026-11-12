import {createServer} from 'vite'
import {DatabaseSync} from 'node:sqlite'
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {handleJourneyRequest} from '../../server/journeys/api.ts'
import {experimentalProvider} from './geographic-provider.mjs'
import {installMobilityApi} from './mobility-api.mjs'
export async function startPrototype(directory,control={}){
  const root=resolve('.'),manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8')),allowed=new Set(['manifest.json','version.json',manifest.catalog.file,...Object.values(manifest.days).flatMap(d=>[d.file,...(d.trips?[d.trips.file]:[])])])
  const sqlite=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),db={all:async(sql,p=[])=>sqlite.prepare(sql).all(...p)}
  const provider=await experimentalProvider(control.replayFile)
  function setup(server){
  installMobilityApi(server,db,provider)
  server.middlewares.use('/prototype-data',async(req,res)=>{
    const file=(req.url||'').slice(1).split('?')[0]
    if(control.delayMs)await new Promise(ok=>setTimeout(ok,control.delayMs))
    if(control.fail&&file.includes(control.fail)){res.statusCode=503;res.end();return}
    if(!allowed.has(file)){res.statusCode=404;res.end();return}
    try{const bytes=await readFile(resolve(directory,file));res.setHeader('Content-Type',file.endsWith('.json')?'application/json':'application/octet-stream');res.setHeader('Cache-Control',file.endsWith('.json')?'no-store':'private,max-age=0,must-revalidate');res.end(bytes)}catch(e){res.statusCode=e.code==='ENOENT'&&file==='version.json'?404:503;res.end()}
  })
  server.middlewares.use('/prototype/reference',async(req,res)=>{
    try{let text='';for await(const c of req){text+=c;if(text.length>4096)throw new Error('Requête trop grande')}
      const q=JSON.parse(text),parameters=new URLSearchParams(Object.entries(q).map(([k,v])=>[k,String(v)])),response=await handleJourneyRequest(new Request('http://localhost/api/journeys/search?'+parameters),db)
      res.statusCode=response.status;res.setHeader('Content-Type','application/json');res.end(await response.text())
    }catch{res.statusCode=400;res.end(JSON.stringify({error:'Requête expérimentale invalide'}))}
  })
  }
  const server=await createServer({configFile:false,root,plugins:[{name:'isolated-hybrid-laboratory',configureServer:setup}],optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0,watch:{ignored:['**/.data/**']},fs:{deny:['**/.data/**','**/GTFS_TCL.ZIP','.env','.env.*']}}})
  await server.listen();const address=server.httpServer.address();return{url:`http://127.0.0.1:${address.port}/experiments/hybrid/index.html`,provider,close:async()=>{await server.close();sqlite.close()}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const server=await startPrototype(resolve(process.argv[2]||''),{replayFile:process.argv[3]?resolve(process.argv[3]):undefined});console.log(server.url);console.log(server.url.replace('index.html','mobility.html'));console.log(server.provider.mode)}
