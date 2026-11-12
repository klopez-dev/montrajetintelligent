import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {DatabaseSync} from 'node:sqlite'
import {createNetworkPlanner} from '../../server/journeys/network.ts'
import {startPrototype} from './serve.mjs'
import {startBrowser} from '../qa/browser-driver.mjs'
const output=resolve(`.data/hybrid-memory-${Date.now()}`);await mkdir(output)
const manifest=JSON.parse(await readFile(resolve(process.argv[2]||'','manifest.json'),'utf8'))
const report={cases:[],checks:[],samples:[],errors:[],limitations:['CDP heap samples + backing storage are not process RSS, not an exact decomposition of native memory.','Sampling cannot guarantee observation of transient decompression peaks. Forced GC is diagnostic, not a production strategy.','Local HTTP/Vite, not Internet or physical mobile.']}
const canonical=r=>({state:r.state,itineraries:r.itineraries,scope:r.scope,warnings:r.warnings})
function stats(values){const a=[...values].sort((a,b)=>a-b);return{n:a.length,min:a[0],median:a[Math.floor(a.length/2)],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)}}
let server,browser,session
const native=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),planner=createNetworkPlanner({all:async(s,p=[])=>native.prepare(s).all(...p)})
try{
 server=await startPrototype(resolve(process.argv[2]||''));browser=await startBrowser(output);const d=browser.driver;report.browser=browser.version
 d.on('Target.attachedToTarget',e=>{if(e.targetInfo.type==='worker')session=e.sessionId})
 await d.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true})
 await d.send('Page.navigate',{url:server.url});await d.wait('document.querySelector("#run")?.onclick',30000)
 await d.evaluate(`window.__gaps=[];window.__lastTick=performance.now();window.__heartbeat=setInterval(()=>{const now=performance.now();window.__gaps.push(now-window.__lastTick);window.__lastTick=now},16)`)
 async function start(){session=undefined;return d.evaluate(`(async()=>{window.__w?.terminate();const at=performance.now();window.__w=new Worker('/experiments/hybrid/browser-worker.ts',{type:'module'});await new Promise((ok,bad)=>{window.__w.onmessage=e=>{if(e.data.ready)ok()};window.__w.onerror=e=>bad(new Error(e.message))});return performance.now()-at})()`)}
 async function send(message){return d.evaluate(`new Promise((ok,bad)=>{window.__w.onmessage=e=>{if(e.data.id===1){if(e.data.error)bad(new Error(e.data.error));else ok(e.data)}};window.__w.onerror=e=>bad(new Error(e.message));window.__w.postMessage(${JSON.stringify({id:1,...message})})})`)}
 async function heap(){return{main:await d.send('Runtime.getHeapUsage'),worker:session?await d.send('Runtime.getHeapUsage',{},session):null}}
 async function probe(operation){let stopped=false;const samples=[],loop=(async()=>{while(!stopped){try{samples.push({at:Date.now(),...await heap()})}catch(e){report.errors.push('memory sample: '+e.message)}await delay(20)}})();try{const at=performance.now(),value=await operation();return{value,samples,operationMs:performance.now()-at}}finally{stopped=true;await loop}}
 const q=kind=>({fromStopId:kind==='one'?'2397':kind==='two'?'1138':'35660',toStopId:['one','two','arrival'].includes(kind)?'36394':'35668',at:kind==='midnight'?'2026-11-09T23:05:00Z':kind==='holiday'?'2026-11-11T10:00:00Z':kind==='date'?'2026-11-12T10:00:00Z':kind==='arrival'?'2026-11-09T11:00:00Z':'2026-11-09T10:00:00Z',mode:kind==='arrival'?'arrival':'departure',order:kind==='arrival'?'departure':'arrival',marginSeconds:120,maxTransfers:2})
 async function run(kind,cache,initializationMs=0){
   const query=q(kind),sampled=await probe(()=>send({query})),wallMs=sampled.operationMs,r=sampled.value
   const reference=await planner.search(query);assert.deepEqual(canonical(r.result),canonical(reference))
   const row={kind,cache,initializationMs,wallMs,workerMs:r.elapsedMs,calculationMs:r.calculationMs,serializationMs:r.serializationMs,compressedBytes:r.compressedBytes,requests:r.requests,days:r.residentDays,metrics:r.metrics,proposals:r.result.itineraries.length,after:await heap(),samples:sampled.samples}
   report.cases.push(row);console.log(kind,cache,wallMs.toFixed(1))
 }
 for(const kind of ['direct','one','two'])for(let repeat=0;repeat<5;repeat++){const init=await start();await run(kind,'cold',init);await run(kind,'warm')}
 for(const kind of ['one','two','arrival','midnight',...(manifest.days['2026-11-12']?['holiday','date']:[]),'direct','one','two'])await run(kind,'successive')
 report.beforeRelease=await heap();await send({command:'release'});report.afterRelease=await heap()
 try{await d.send('HeapProfiler.collectGarbage',{},session);await d.send('HeapProfiler.collectGarbage');report.afterReleaseAndGC=await heap()}catch(e){report.gcUnavailable=e.message}
 await d.evaluate('window.__w.terminate();window.__w=null');report.afterTerminationMain=await d.send('Runtime.getHeapUsage');report.checks.push('Release + termination, sampled memory recorded')
 for(const width of [390,320]){await d.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});assert.equal(await d.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await d.screenshot(resolve(output,`memory-${width}.png`))}report.checks.push('Mobile viewport 390 / 320, no horizontal overflow')
 try{await d.send('Emulation.setCPUThrottlingRate',{rate:4});report.mainCpuSlowdown=4;await start();try{await d.send('Emulation.setCPUThrottlingRate',{rate:4},session);report.workerCpuSlowdown=4}catch(e){report.workerCpuThrottleUnavailable=e.message}await run('direct','main-cpu-4x');await d.send('Emulation.setCPUThrottlingRate',{rate:1})}catch(e){report.cpuThrottleUnavailable=e.message}
 await start()
 try{await d.send('Network.enable',{},session);await d.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:375000,uploadThroughput:375000},session);report.networkThrottle='worker CDP: 100 ms, 375000 bytes/s';await run('direct','network-slow')}catch(e){report.networkThrottleUnavailable=e.message}
 await d.evaluate('window.__w.terminate();window.__w=null;clearInterval(window.__heartbeat)')
 report.mainHeartbeat=stats(await d.evaluate('window.__gaps'));report.groups={}
 for(const kind of ['direct','one','two'])for(const cache of ['cold','warm']){const rows=report.cases.filter(c=>c.kind===kind&&c.cache===cache);report.groups[kind+'-'+cache]={wallMs:stats(rows.map(c=>c.wallMs)),workerMs:stats(rows.map(c=>c.workerMs)),initializationMs:stats(rows.map(c=>c.initializationMs))}}
 await d.reload();await d.wait('document.querySelector("#run")?.onclick');assert.equal(await d.evaluate('document.querySelector("#output").dataset.status'),'idle');report.checks.push('Page reload resets laboratory')
 report.status='passed'
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1}
finally{native.close();await browser?.close();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
