import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startBrowser} from '../qa/browser-driver.mjs'
import {servePreproduction} from './serve-preproduction.mjs'
const output=resolve(`.data/preproduction-faults-${Date.now()}`);await mkdir(output)
const directory=resolve(process.argv[2]||''),manifest=JSON.parse(await readFile(resolve(directory,'prototype-data/manifest.json'),'utf8')),control={},report={checks:[],unverified:[]};let server,browser
try{
 server=await servePreproduction(directory,control);browser=await startBrowser(output);const d=browser.driver;let session
 d.on('Target.attachedToTarget',e=>{if(e.targetInfo.type==='worker')session=e.sessionId});await d.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true})
 const reload=async()=>{await d.send('Page.navigate',{url:server.url+'?'+Date.now()});await d.wait('document.querySelector(".journey-panel")')}
 const path='/api/journeys/search?'+new URLSearchParams({fromStopId:'35660',toStopId:'35668',at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:'120',maxTransfers:'2'})
 const search=()=>d.evaluate(`(async()=>{const response=await fetch(${JSON.stringify(path)});return(await response.text()).trim().split(String.fromCharCode(10)).map(JSON.parse)})()`)
 for(const fail of ['manifest.json',manifest.days['2026-11-09'].file]){control.fail=fail;await reload();const events=await search();assert.ok(events.some(e=>e.type==='error'));assert.equal(events.some(e=>e.type==='result'),false);report.checks.push('503 explicit, no fabricated result: '+fail)}control.fail=null
 control.corrupt=manifest.days['2026-11-09'].file;await reload();assert.match((await search()).find(e=>e.type==='error').message,/Empreinte/);control.corrupt=null;report.checks.push('Corrupted partition rejected')
 await reload();await d.evaluate('window.Worker=class{constructor(){throw new Error("Worker indisponible (simulation)")}}');assert.match((await search()).find(e=>e.type==='error').message,/Worker indisponible/);report.checks.push('Unavailable Worker produces explicit error')
 await reload();await d.evaluate(`(async()=>{const r=await fetch('/api/gtfs/status');return r.json()})()`)
 try{
  await d.send('Network.enable',{},session);await d.send('Network.setBlockedURLs',{urls:['*data.geopf.fr*']},session)
  const ign=await d.evaluate(`(async()=>{const r=await fetch('/api/mobility/addresses?q=12+avenue+Lacassagne+Lyon');return{status:r.status,body:await r.json()}})()`);assert.equal(ign.status,503);assert.match(ign.body.error,/IGN/);assert.ok((await search()).some(e=>e.type==='result'));report.checks.push('External Internet/IGN blocked: stops still route, addresses explicitly unavailable')
  await d.send('Network.setBlockedURLs',{urls:[]},session)
 }catch(e){report.unverified.push('Worker URL blocking: '+e.message)}
 try{
  d.on('Fetch.requestPaused',(e,s)=>{if(s===session)void d.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:429,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Retry-After',value:'1'}],body:Buffer.from('{"error":"QA quota"}').toString('base64')},s)})
  await d.send('Fetch.enable',{patterns:[{urlPattern:'https://data.geopf.fr/*'}]},session)
  const r=await d.evaluate(`(async()=>{const r=await fetch('/api/mobility/addresses?q=14+avenue+Lacassagne+Lyon');return{status:r.status,body:await r.json()}})()`);assert.equal(r.status,503);assert.match(r.body.error,/429/);report.checks.push('Simulated quota HTTP429 in browser, no supplier quota exhausted');await d.send('Fetch.disable',{},session)
 }catch(e){report.unverified.push('Worker 429 interception: '+e.message)}
 const bad=await d.evaluate(`(async()=>{const r=await fetch('/api/maps',{method:'POST',body:JSON.stringify({feedSha256:'WRONG',legs:[]})});return{status:r.status,body:await r.json()}})()`);assert.equal(bad.status,503);report.checks.push('Wrong map version rejected')
 control.delayMs=300;await reload();const offset=server.requests.length;await d.evaluate(`(()=>{window.__abortSearch=new AbortController();window.__cancelEvents=null;fetch(${JSON.stringify(path)},{signal:window.__abortSearch.signal}).then(r=>r.text()).then(text=>window.__cancelEvents=text.trim().split(String.fromCharCode(10)).map(JSON.parse)).catch(e=>window.__cancelEvents=[{type:'error',message:e.message}]);return true})()`);const end=Date.now()+10000;while(!server.requests.slice(offset).some(p=>p.includes('manifest.json'))&&Date.now()<end)await new Promise(ok=>setTimeout(ok,20));assert.ok(server.requests.slice(offset).some(p=>p.includes('manifest.json')));await d.evaluate('window.__abortSearch.abort()');await d.wait('window.__cancelEvents');assert.equal((await d.evaluate('window.__cancelEvents')).some(e=>e.type==='result'),false);report.checks.push('Actual in-flight cold GTFS load cancelled without a late result');control.delayMs=0
 assert.equal(server.requests.some(p=>p.startsWith('/api/')),false);report.status='passed'
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1}finally{await browser?.close();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
