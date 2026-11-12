import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startBrowser} from '../qa/browser-driver.mjs'
import {startFirefox} from '../qa/firefox-driver.mjs'
import {startPrototype} from './serve.mjs'
const directory=resolve(process.argv[2]||''),kind=process.argv[3]||'edge',output=resolve(`.data/hybrid-complete-${kind}-${Date.now()}`);await mkdir(output)
const replayFile=process.argv[4]||'.data/hybrid-complete-ign-1794334290229/official-replay.json',report={cases:[],checks:[],errors:[],notes:['Full browser worker mobility calculation; official IGN recorded responses explicitly replayed by existing provider interface. No fresh walking assertion.','DOM clicks in Firefox, native clicks in Edge. Desktop + viewport simulation, no physical phone.']};let server,browser
const stats=values=>{const a=values.toSorted((a,b)=>a-b);return{n:a.length,min:a[0],median:a[Math.floor(a.length/2)],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)}}
try{
 server=await startPrototype(directory,{replayFile});browser=kind==='firefox'?await startFirefox(output):await startBrowser(output);report.browser=browser.version;const d=browser.driver,workers=[]
 if(kind==='edge'){d.on('Target.attachedToTarget',e=>{if(e.targetInfo.type==='worker')workers.push(e.sessionId)});await d.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true})}
 const navigate=url=>kind==='edge'?d.send('Page.navigate',{url}):d.navigate(url),viewport=width=>kind==='edge'?d.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600}):d.viewport(width)
 const url=server.url.replace('index.html','mobility.html');await navigate(url);await d.wait('document.querySelector("#load")?.onclick',30000)
 await d.evaluate(`(()=>{window.__workerCount=0;window.__stages=[];window.__gaps=[];window.__last=performance.now();window.__heartbeat=setInterval(()=>{const t=performance.now();window.__gaps.push(t-window.__last);window.__last=t},16);window.Worker=class extends Worker{constructor(...args){super(...args);window.__workerCount++}};new MutationObserver(()=>window.__stages.push(document.querySelector('#stage').textContent)).observe(document.querySelector('#stage'),{childList:true});return true})()`)
 await d.click('#load');await d.wait('!document.querySelector("#run").disabled',30000);assert.equal(await d.evaluate('document.querySelector("#engine").value'),'sqlite')
 await d.click('#run');await d.wait('!document.querySelector("#run").disabled',60000);assert.equal(await d.evaluate('document.querySelector("#output").dataset.status'),'passed');assert.equal(await d.evaluate('window.__workerCount'),0);report.checks.push('SQLite default: no worker constructed, no double execution')
 const ids=await d.evaluate('[...document.querySelector("#scenario").options].map(o=>o.value)')
 for(const scenario of ids)for(let repeat=0;repeat<3;repeat++){
  await d.evaluate(`(()=>{document.querySelector('#scenario').value=${JSON.stringify(scenario)};document.querySelector('#engine').value='compare'})()`)
  await d.evaluate('window.__gaps=[]');const at=performance.now();await d.click('#run');await d.wait('!document.querySelector("#run").disabled',90000);const status=await d.evaluate('document.querySelector("#output").dataset.status');if(status!=='passed')throw new Error('Scenario '+scenario+': '+status+' '+await d.evaluate('document.querySelector("#issue").textContent'))
  const r=JSON.parse(await d.evaluate('document.querySelector("#output").textContent'));assert.equal(r.equal,true);assert.ok(r.result.itineraries.length,'No real itinerary '+scenario)
  const row={scenario,repeat,perceivedMs:r.totalPerceivedMs,harnessMs:performance.now()-at,workerMs:r.elapsedMs,calculationMs:r.calculationMs,serializationMs:r.serializationMs,mobilityMetrics:r.result.metrics,bytes:r.compressedBytes,requests:r.requests,days:r.residentDays,metrics:r.metrics,state:r.result.state,proposals:r.result.itineraries.length,providerIssues:r.result.providerIssues,heartbeatSamples:await d.evaluate('window.__gaps')}
  if(kind==='edge')row.memory={main:await d.send('Runtime.getHeapUsage'),worker:await d.send('Runtime.getHeapUsage',{},workers.at(-1))}
  report.cases.push(row);console.log(kind,scenario,repeat,Math.round(r.totalPerceivedMs),r.result.itineraries.length)
 }
 await d.evaluate(`(()=>{document.querySelector('#scenario').value='address-address';document.querySelector('#mode').value='arrival';document.querySelector('#at').value='2026-11-09T12:00:00Z'})()`);await d.click('#run');await d.wait('!document.querySelector("#run").disabled',90000);assert.equal(await d.evaluate('document.querySelector("#output").dataset.status'),'passed');assert.equal(JSON.parse(await d.evaluate('document.querySelector("#output").textContent')).equal,true);report.checks.push('Address arrive-before structured parity')
 for(const width of [1440,768,390,320]){await viewport(width);assert.equal(await d.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await d.screenshot(resolve(output,`complete-${width}.png`))}report.checks.push('1440 / 768 / 390 / 320 without horizontal overflow')
 report.progress=[...new Set(await d.evaluate('window.__stages'))];assert.ok(report.progress.some(s=>s.includes('parcours piétons')));report.checks.push('Real progress observed through worker')
 await d.evaluate(`(()=>{document.querySelector('#engine').value='hybrid';document.querySelector('#mode').value='departure';document.querySelector('#at').value='2026-11-10T10:00:00Z';document.querySelector('#scenario').value='address-address'})()`);await d.click('#run');await d.wait('document.querySelector("#run").disabled');await d.click('#cancel');assert.equal(await d.evaluate('document.querySelector("#output").dataset.status'),'cancelled');await new Promise(ok=>setTimeout(ok,500));assert.equal(await d.evaluate('document.querySelector("#output").dataset.status'),'cancelled');report.checks.push('Door-to-door cancellation cannot publish a late result')
 report.groups=Object.fromEntries(ids.map(id=>[id,{perceivedMs:stats(report.cases.filter(c=>c.scenario===id).map(c=>c.perceivedMs)),workerMs:stats(report.cases.filter(c=>c.scenario===id).map(c=>c.workerMs))}]))
 report.heartbeat=stats(await d.evaluate('window.__gaps'));report.queryHeartbeat=stats(report.cases.flatMap(c=>c.heartbeatSamples));report.provider=server.provider.metrics();report.status='passed'
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1;if(browser)try{report.dom=await browser.driver.evaluate('document.body.innerText.slice(0,12000)')}catch{}}
finally{await browser?.close();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
