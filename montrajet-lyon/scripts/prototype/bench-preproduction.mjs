import assert from 'node:assert/strict'
import {mkdir,writeFile,stat} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startBrowser} from '../qa/browser-driver.mjs'
import {servePreproduction} from './serve-preproduction.mjs'
const output=resolve(`.data/preproduction-bench-${Date.now()}`);await mkdir(output);const report={cases:[],notes:['Local HTTP, five fresh-page/worker cold runs followed by warm calls. Supplier not contacted.','Heap snapshots are not physical mobile memory or exact transient peaks. CPU throttle applies to page only.']},control={};let browser,server,session
const stats=values=>{const a=values.toSorted((a,b)=>a-b);return{n:a.length,min:a[0],median:a[Math.floor(a.length/2)],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)}}
try{
 const directory=resolve(process.argv[2]||'');server=await servePreproduction(directory,control);browser=await startBrowser(output);const d=browser.driver
 d.on('Target.attachedToTarget',e=>{if(e.targetInfo.type==='worker')session=e.sessionId});await d.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true})
 await d.send('Page.addScriptToEvaluateOnNewDocument',{source:`{const Native=Worker;window.Worker=class extends Native{constructor(...args){const at=performance.now();super(...args);if(String(args[0]).includes('/assets/worker-'))this.addEventListener('message',()=>{window.__qaWorkerBootMs=performance.now()-at},{once:true})}}}`})
 const path='/api/journeys/search?'+new URLSearchParams({fromStopId:'35660',toStopId:'35668',at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:'120',maxTransfers:'2'})
 async function load(){await d.send('Network.clearBrowserCache');const started=performance.now();await d.send('Page.navigate',{url:server.url+'?'+Date.now()});await d.wait('document.querySelector(".journey-panel")',30000);return performance.now()-started}
 async function run(mode,openMs=0){const offset=server.requests.length,start=performance.now(),result=await d.evaluate(`(async()=>{const r=await fetch(${JSON.stringify(path)}),text=await r.text();return text.trim().split(String.fromCharCode(10)).map(JSON.parse).find(e=>e.type==='result')?.value})()`);assert.equal(result.status,'connected');let bytes=0;const paths=server.requests.slice(offset);for(const path of paths){try{bytes+=(await stat(resolve(directory,'.'+path))).size}catch{}}
  const sample={mode,openMs,totalMs:performance.now()-start,gtfsMetrics:result.data.metrics,workerBootToFirstMessageMs:await d.evaluate('window.__qaWorkerBootMs??null'),diagnostics:await d.evaluate('window.__MTL_PREPRODUCTION__?.snapshot()'),requests:paths.length,bytes,mainHeap:await d.send('Runtime.getHeapUsage'),workerHeap:await d.send('Runtime.getHeapUsage',{},session)};report.cases.push(sample);console.log(mode,sample.totalMs,paths.length,bytes)
 }
 for(let i=0;i<5;i++){const open=await load();await run('cold',open);await run('warm')}
 await d.send('Emulation.setCPUThrottlingRate',{rate:4});await run('main-cpu-4x',await load());await d.send('Emulation.setCPUThrottlingRate',{rate:1})
 control.delayMs=100;control.throughputBytes=375000
 for(let i=0;i<3;i++)await run('slow',await load())
 report.groups=Object.fromEntries(['cold','warm','slow','main-cpu-4x'].map(mode=>[mode,{totalMs:stats(report.cases.filter(c=>c.mode===mode).map(c=>c.totalMs)),openMs:stats(report.cases.filter(c=>c.mode===mode).map(c=>c.openMs))}]))
 report.status='passed'
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1}finally{await browser?.close();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
