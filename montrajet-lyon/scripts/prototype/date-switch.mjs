import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {createJourneyPlanner} from '../../server/journeys/planner.ts'
import {startPrototype} from './serve.mjs'
import {startBrowser} from '../qa/browser-driver.mjs'
const output=resolve(`.data/hybrid-date-switch-${Date.now()}`);await mkdir(output);const report={checks:[],searches:[]},native=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),planner=createJourneyPlanner({all:async(s,p=[])=>native.prepare(s).all(...p)});let browser,server
const canonical=r=>({state:r.state,itineraries:r.itineraries,scope:r.scope,warnings:r.warnings})
try{
 server=await startPrototype(resolve(process.argv[2]||''),{delayMs:100});browser=await startBrowser(output);const d=browser.driver
 await d.send('Page.navigate',{url:server.url});await d.wait('document.querySelector("#run")?.onclick')
 const query={fromStopId:'35660',toStopId:'35668',at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:120,maxTransfers:2}
 const result=await d.evaluate(`(async()=>{const {HybridClient}=await import('/experiments/hybrid/client.ts');window.__dateClient=new HybridClient();const q=${JSON.stringify(query)};const a=window.__dateClient.search(q).then(()=>({cancelled:false}),e=>({cancelled:e.name==='AbortError'}));await new Promise(ok=>setTimeout(ok,80));const b=await window.__dateClient.search({...q,at:'2026-11-11T10:00:00Z'});return{older:await a,newer:b}})()`)
 assert.equal(result.older.cancelled,true);assert.deepEqual(canonical(result.newer.result),canonical(await planner.search({...query,at:'2026-11-11T10:00:00Z'})));report.checks.push('Quick date change cancels old worker and returns only the new date')
 for(const at of ['2026-11-09T10:00:00Z','2026-11-10T10:00:00Z','2026-11-12T10:00:00Z','2026-11-13T10:00:00Z','2026-11-13T10:30:00Z']){
  const q={...query,at},r=await d.evaluate(`window.__dateClient.search(${JSON.stringify(q)})`);assert.deepEqual(canonical(r.result),canonical(await planner.search(q)));assert.ok(r.residentDays.length<=3);report.searches.push({at,bytes:r.compressedBytes,requests:r.requests,days:r.residentDays,metrics:r.metrics})
 }
 const last=report.searches.at(-1),before=report.searches.at(-2);assert.equal(last.requests,before.requests+1);assert.equal(last.metrics[0].phase,'version');report.checks.push('Hour-only change downloads only the lightweight version pointer')
 await d.evaluate('window.__dateClient.cancel()');report.status='passed'
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1}finally{native.close();await browser?.close();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
