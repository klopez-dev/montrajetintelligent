import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startBrowser} from '../qa/browser-driver.mjs'
import {servePreproduction} from './serve-preproduction.mjs'
const output=resolve(`.data/step1-address-bench-${Date.now()}`);await mkdir(output);const report={samples:[],note:'Three fresh workers, browser HTTP cache cleared before each cold run. Official IGN live, one queue at a time; no replay. Fixed selected BAN IDs from the explicit live matrix. Warm repeats share in-memory caches.'};let server,browser
try{
 const matrix=JSON.parse(await readFile('.data/step1-matrix-1794343297967/report.json','utf8')),query=matrix.cases.find(c=>c.name==='requested-address-address').query;server=await servePreproduction(resolve(process.argv[2]));browser=await startBrowser(output);const d=browser.driver
 for(let i=0;i<3;i++){
  await d.send('Network.clearBrowserCache')
  await d.send('Page.navigate',{url:server.url+'?repeat='+i});await d.wait('window.__MTL_PREPRODUCTION__ && document.querySelector(".journey-panel")')
  for(const mode of ['cold','warm']){
   await d.evaluate(`(()=>{window.__done=null;window.__error='';const at=performance.now();fetch('/api/mobility/search',{method:'POST',body:JSON.stringify(${JSON.stringify(query)})}).then(r=>r.text()).then(text=>{const events=text.trim().split(String.fromCharCode(10)).map(JSON.parse),r=events.find(e=>e.type==='result');if(!r)throw new Error(events.find(e=>e.type==='error')?.message);window.__done={wallMs:performance.now()-at,count:r.value.data.itineraries.length,metrics:r.value.data.metrics}}).catch(e=>window.__error=e.message);return true})()`);await d.wait('window.__done || window.__error',90000);assert.equal(await d.evaluate('window.__error'),'');const sample=await d.evaluate('window.__done');assert.ok(sample.count);report.samples.push({repeat:i,mode,...sample});console.log(i,mode,Math.round(sample.wallMs),sample.metrics.upstreamRequests)
  }
 }
 assert.equal(server.requests.some(p=>p.startsWith('/api/')),false);report.status='passed'
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1}finally{await browser?.close();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
