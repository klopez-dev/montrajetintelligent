import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startBrowser} from '../qa/browser-driver.mjs'
import {servePreproduction} from './serve-preproduction.mjs'
import {auditJourney} from '../../tests/helpers/journeys.mjs'
import {emptyFavoriteStore,savePlace,saveTrip,resolveEndpoint} from '../../src/services/favorites.ts'
const output=resolve(`.data/step1-matrix-${Date.now()}`);await mkdir(output)
const sqlite=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),report={cases:[],network:[],checks:[],errors:[],note:'All IGN results in this run are live/cached by the real provider, not replayed. SQLite is a read-only QA oracle, never an HTTP backend.'};let browser,server
function audit(result,query){
 const tuples=[]
 for(const item of result.itineraries){
  auditJourney(sqlite,item.transitResult,item.transit)
  const connections=item.transit.connections??(item.transit.connection?[item.transit.connection]:[])
  assert.equal(item.safetySeconds,item.access?query.marginSeconds:0)
  assert.equal(Date.parse(item.departureTime),Date.parse(item.transit.departureTime)-((item.access?.durationSeconds||0)+item.safetySeconds)*1000)
  assert.equal(Date.parse(item.arrivalTime),Date.parse(item.transit.arrivalTime)+(item.egress?.durationSeconds||0)*1000)
  assert.equal(item.durationSeconds,(Date.parse(item.arrivalTime)-Date.parse(item.departureTime))/1000)
  assert.equal(item.walkingSeconds,(item.access?.durationSeconds||0)+(item.egress?.durationSeconds||0)+connections.reduce((sum,c)=>sum+(c.walkingSeconds||0),0))
  assert.ok(query.mode==='arrival'?Date.parse(item.arrivalTime)<=Date.parse(query.at):Date.parse(item.departureTime)>=Date.parse(query.at))
  for(const path of [item.access,item.egress,...connections.map(c=>c.walkingPath)].filter(Boolean)){assert.equal(path.source,'IGN BD TOPO');assert.equal(path.profile,'pedestrian');assert.ok(path.durationSeconds>0&&path.geometry.coordinates.length>=2);assert.ok(path.startSnapMeters<=25&&path.endSnapMeters<=25);assert.ok(Number.isFinite(Date.parse(path.fetchedAt)))}
  const waiting=item.safetySeconds+connections.reduce((sum,c)=>sum+c.intervalSeconds-(c.walkingSeconds||0),0);assert.equal(item.waitingSeconds,item.unknownTransferWalking?null:waiting)
  tuples.push([Date.parse(item.arrivalTime),item.durationSeconds,item.transit.transfers])
 }
 if(query.order==='arrival')for(let i=1;i<tuples.length;i++){const a=tuples[i-1],b=tuples[i];assert.ok(a[0]<b[0]||a[0]===b[0]&&(a[1]<b[1]||a[1]===b[1]&&a[2]<=b[2]),'Arrival ranking')}
}
try{
 server=await servePreproduction(resolve(process.argv[2]||''));browser=await startBrowser(output);const d=browser.driver
 const enabled=new Set(),records=new Map()
 const key=(sid,id)=>(sid||'page')+':'+id
 d.on('Target.attachedToTarget',e=>{if(e.targetInfo.type==='worker'){const sid=e.sessionId;enabled.add(sid);void d.send('Network.enable',{},sid).catch(e=>report.errors.push('Worker network capture: '+e.message))}})
 await d.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true})
 d.on('Network.requestWillBeSent',(e,sid)=>{const u=new URL(e.request.url);if(!['http:','https:'].includes(u.protocol))return;const r={url:e.request.url,domain:u.hostname,path:u.pathname,method:e.request.method,origin:sid&&enabled.has(sid)?'worker':'page',initiator:e.initiator.type,authorizationPresent:Object.keys(e.request.headers).some(k=>/authorization|api.?key|secret/i.test(k)),category:u.hostname==='data.geopf.fr'?'IGN':u.hostname.endsWith('tcl.fr')?'TCL':u.hostname==='tile.openstreetmap.org'?'tiles':u.origin===new URL(server.url).origin?'local-static':'other-external'};records.set(key(sid,e.requestId),r);report.network.push(r)})
 d.on('Network.responseReceived',(e,sid)=>{const r=records.get(key(sid,e.requestId));if(r){r.status=e.response.status;r.mime=e.response.mimeType;r.corsAllowOrigin=e.response.headers['access-control-allow-origin']||e.response.headers['Access-Control-Allow-Origin']||null;r.cache=e.response.headers['cache-control']||e.response.headers['Cache-Control']||null;r.fromDiskCache=e.response.fromDiskCache||false}})
 d.on('Network.loadingFinished',(e,sid)=>{const r=records.get(key(sid,e.requestId));if(r)r.transferBytes=e.encodedDataLength})
 d.on('Runtime.exceptionThrown',e=>report.errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text))
 await d.send('Page.navigate',{url:server.url});await d.wait('document.querySelector(".journey-panel")')
 async function addresses(q,prefix){const r=await d.evaluate(`(async()=>{const r=await fetch('/api/mobility/addresses?'+new URLSearchParams({q:${JSON.stringify(q)}}));return r.json()})()`);assert.equal(r.status,'connected',r.error);const place=r.data.find(p=>p.precision==='housenumber'&&p.name.startsWith(prefix));assert.ok(place,'Explicit official address '+prefix);return place}
 const home=await addresses('135 Avenue Lacassagne Lyon','135 Avenue Lacassagne'),work=await addresses('10 Rue Olympe de Gouges Villeurbanne','10 Rue Olympe de Gouges');report.addresses={home,work}
 let store=emptyFavoriteStore();store=savePlace(store,{role:'home',name:'QA domicile',location:home});store=savePlace(store,{role:'work',name:'QA travail',location:work});store=saveTrip(store,{name:'QA mixte',from:{placeId:store.places.find(p=>p.role==='home').id},to:{location:{kind:'stop',id:'35668',name:'Vaulx-en-Velin La Soie'}},preferences:{marginSeconds:180,mode:'departure',walkingTransfers:false,maxTransfers:2}})
 const ref=p=>p.kind==='address'?{kind:'address',id:p.id,name:p.name,expectedCoordinates:{latitude:p.latitude,longitude:p.longitude}}:{kind:'stop',id:p.id},H=ref(home),W=ref(work),S={kind:'stop',id:'35660'},D={kind:'stop',id:'35668'}
 const cases=[['stop-stop',S,D,120],['requested-address-address',H,W,120],['address-stop',H,D,120],['stop-address',S,W,120],['home-work',ref(resolveEndpoint(store,{placeId:store.places.find(p=>p.role==='home').id})),W,180],['work-home',W,H,180],['custom-favorite',ref(resolveEndpoint(store,store.trips[0].from)),ref(resolveEndpoint(store,store.trips[0].to)),180]]
 async function search(name,from,to,marginSeconds=120,overrides={}){
  const query={from,to,at:'2026-11-10T07:00:00Z',mode:'departure',order:'arrival',walkingTransfers:false,maxTransfers:2,marginSeconds,...overrides}
  await d.evaluate(`(()=>{window.__step1Result=null;window.__step1Error='';const at=performance.now();fetch('/api/mobility/search',{method:'POST',body:JSON.stringify(${JSON.stringify(query)})}).then(r=>r.text()).then(text=>{const events=text.trim().split(String.fromCharCode(10)).map(JSON.parse),r=events.find(e=>e.type==='result');if(!r)throw new Error(events.find(e=>e.type==='error')?.message||'No result');window.__step1Result={result:r.value.data,wallMs:performance.now()-at}}).catch(e=>window.__step1Error=e.message);return true})()`)
  await d.wait('window.__step1Result || window.__step1Error',90000);assert.equal(await d.evaluate('window.__step1Error'),'');const captured=await d.evaluate('window.__step1Result');audit(captured.result,query);report.cases.push({name,query,...captured});console.log(name,captured.result.itineraries.length,Math.round(captured.wallMs),captured.result.metrics.upstreamRequests);return captured.result
 }
 for(const [name,a,b,margin]of cases)await search(name,a,b,margin)
 await search('requested-warm',H,W)
 await search('arrive-before',H,W,120,{at:'2026-11-10T09:00:00Z',mode:'arrival',order:'departure'})
 for(const [name,at]of [['different-date','2026-11-11T07:00:00Z'],['after-midnight','2026-11-10T23:05:00Z'],['outside-validity','2028-01-01T10:00:00Z']])await search(name,S,D,120,{at})
 report.diagnostics=await d.evaluate('window.__MTL_PREPRODUCTION__.snapshot()');assert.ok(report.diagnostics.events.some(e=>e.engine==='worker'))
 assert.equal(server.requests.some(p=>p.startsWith('/api/')),false);assert.equal(report.network.filter(r=>r.category==='TCL'||r.category==='tiles'||r.category==='other-external').length,0);assert.equal(report.network.some(r=>r.authorizationPresent),false)
 report.checks.push('Every returned proposal independently audited against SQLite rows/calendar, door arithmetic and walking constraints','All seven categories executed without an HTTP API backend','No observed TCL/tiles/other service calls or authorization headers');report.status='passed'
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1}finally{sqlite.close();await browser?.close();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
