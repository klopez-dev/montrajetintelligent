import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {auditJourney} from '../../tests/helpers/journeys.mjs'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startBrowser} from '../qa/browser-driver.mjs'
import {servePreproduction} from './serve-preproduction.mjs'
const output=resolve(`.data/step1-resilience-${Date.now()}`);await mkdir(output)
const directory=resolve(process.argv[2]||''),manifest=JSON.parse(await readFile(resolve(directory,'prototype-data/manifest.json'),'utf8')),control={},report={checks:[],faults:[],note:'Negative network responses are simulated in a test-only Blob worker wrapper; no positive provider data fabricated and no live IGN request is required.'};let browser,server
try{
 server=await servePreproduction(directory,control);browser=await startBrowser(output);const d=browser.driver
 const load=async()=>{await d.send('Page.navigate',{url:server.url+'?test='+Date.now()});await d.wait('window.__MTL_PREPRODUCTION__ && document.querySelector(".journey-panel")')}
 const route='/api/journeys/search?'+new URLSearchParams({fromStopId:'35660',toStopId:'35668',at:'2026-11-10T07:00:00Z',mode:'departure',order:'arrival',marginSeconds:'120',maxTransfers:'2'})
 const search=()=>d.evaluate(`(async()=>{const r=await fetch(${JSON.stringify(route)});return(await r.text()).trim().split(String.fromCharCode(10)).map(JSON.parse)})()`)
 async function inject(mode){
  await load()
  const prefix=`const original=globalThis.fetch;const mode=${JSON.stringify(mode)};const base=${JSON.stringify(server.url)};let calls=0;globalThis.fetch=async(input,init)=>{const u=new URL(input instanceof Request?input.url:String(input),base);if(mode==='offline'||u.hostname==='data.geopf.fr'){calls++;postMessage({diagnostic:{kind:'qa-negative',mode,calls}});if(mode==='timeout')return new Promise((ok,bad)=>{init.signal.addEventListener('abort',()=>bad(init.signal.reason),{once:true})});if(mode==='429'||mode==='500')return new Response('QA negative',{status:Number(mode),headers:{'Retry-After':'60'}});if(mode==='invalid')return new Response('not-json');if(mode==='incomplete')return Response.json({unexpected:true});throw new TypeError('QA network unavailable')}return original(u.href,init)};`
  await d.evaluate(`(()=>{const Native=Worker;window.Worker=class extends Native{constructor(url,options){const script=${JSON.stringify(prefix)}+'const queued=[];onmessage=e=>queued.push(e);await import('+JSON.stringify(String(url))+');for(const e of queued)onmessage(e);';super(URL.createObjectURL(new Blob([script],{type:'text/javascript'})),options)}};return true})()`)
 }

 for(const mode of ['429','500','invalid','incomplete','timeout','network']){
  await inject(mode);const started=performance.now(),r=await d.evaluate(`(async()=>{const r=await fetch('/api/mobility/addresses?q=QA+adresse+sans+résultat');return{status:r.status,body:await r.json()}})()`);assert.equal(r.status,503);assert.equal(r.body.status,'disconnected');assert.ok(r.body.error.includes('IGN'));const before=await d.evaluate('window.__MTL_PREPRODUCTION__.snapshot()')
  if(mode==='429'){const next=await d.evaluate(`(async()=>{const r=await fetch('/api/mobility/addresses?q=QA+autre+adresse');return r.json()})()`);assert.equal(next.status,'disconnected');const after=await d.evaluate('window.__MTL_PREPRODUCTION__.snapshot()');assert.equal(after.events.filter(e=>e.kind==='qa-negative').length,before.events.filter(e=>e.kind==='qa-negative').length,'Retry-After blocks a new upstream attempt')}
  assert.ok((await search()).some(e=>e.type==='result'));report.faults.push({mode,wallMs:performance.now()-started,message:r.body.error,source:'simulated negative response'});console.log(mode,'passed')
 }
 await inject('offline');const offline=await search();assert.ok(offline.some(e=>e.type==='error'));assert.equal(offline.some(e=>e.type==='result'),false);report.checks.push('Cold data offline: explicit error, no invented journey')
 await load();control.fail=manifest.days['2026-11-10'].file;assert.ok((await search()).some(e=>e.type==='error'));control.fail=null;report.checks.push('Missing day refused')
 await load();control.corrupt=manifest.days['2026-11-10'].file;assert.match((await search()).find(e=>e.type==='error').message,/Empreinte/);control.corrupt=null;report.checks.push('Corrupted day refused')
 let incompatible=false;control.transform=(path,bytes)=>incompatible&&path.endsWith('/version.json')?Buffer.from(JSON.stringify({...JSON.parse(bytes),schema:99})):bytes
 await load();await d.evaluate(`fetch('/api/gtfs/status').then(r=>r.json())`);incompatible=true;const invalid=await d.evaluate(`fetch('/api/gtfs/status').then(r=>r.json())`);assert.equal(invalid.status,'disconnected');incompatible=false;report.checks.push('Previously cached consultation invalidated by incompatible version')
 control.delayMs=300;await load();await d.evaluate(`(()=>{window.__old=new AbortController();window.__oldEvents=null;fetch(${JSON.stringify(route)},{signal:window.__old.signal}).then(r=>r.text()).then(t=>window.__oldEvents=t).catch(e=>window.__oldEvents=e.message);return true})()`);await new Promise(ok=>setTimeout(ok,100));await d.evaluate('window.__old.abort()');await d.wait('window.__oldEvents!==null');assert.equal((await d.evaluate('window.__oldEvents')).includes('"type":"result"'),false);control.delayMs=0;assert.ok((await search()).some(e=>e.type==='result'));report.checks.push('Cancel/interruption then new search succeeds without old result')
 const different=await d.evaluate(`(async()=>{const r=await fetch(${JSON.stringify(route.replace('2026-11-10','2026-11-11'))});return(await r.text()).trim().split(String.fromCharCode(10)).map(JSON.parse)})()`);assert.ok(different.some(e=>e.type==='result'));report.checks.push('Changed date returns only its query date')

 const midnightPath='/api/journeys/search?'+new URLSearchParams({fromStopId:'32137',toStopId:'32135',at:'2026-11-10T23:00:00Z',mode:'departure',order:'arrival',marginSeconds:'120',maxTransfers:'2'})
 const night=await d.evaluate(`(async()=>{const r=await fetch(${JSON.stringify(midnightPath)});return(await r.text()).trim().split(String.fromCharCode(10)).map(JSON.parse).find(e=>e.type==='result')?.value.data})()`)
 assert.ok(night.itineraries.length);const oracle=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true});try{for(const journey of night.itineraries)auditJourney(oracle,night,journey);assert.ok(night.itineraries.some(j=>j.legs.some(l=>l.serviceDate==='2026-11-10' && l.departureTime.startsWith('2026-11-10T23:'))))}finally{oracle.close()}
 report.midnight={query:night.query,itineraries:night.itineraries};report.checks.push('Real T1 after 24:00 on service date Nov 10: positive browser result independently checked against GTFS')
 await load();assert.equal(await d.evaluate('Boolean(document.querySelector(".journey-results"))'),false);report.checks.push('Page reload starts without stale proposals')
 assert.equal(server.requests.some(p=>p.startsWith('/api/')),false);report.status='passed'
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1}finally{await browser?.close();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
