import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startBrowser} from '../qa/browser-driver.mjs'
import {startPrototype} from './serve.mjs'
const output=resolve(`.data/hybrid-browser-${Date.now()}`);await mkdir(output)
const report={checks:[],cases:[],errors:[],notes:['Isolated laboratory, not active application. Local static assets only; SQLite reference separate from browser computation.','Browser duration is wall time, not CPU accounting. Worker heap readings are samples, not peak memory.']},checked=s=>{report.checks.push(s);console.log('OK '+s)}
let server,browser;const workers=[]
try{
 server=await startPrototype(resolve(process.argv[2]||''));browser=await startBrowser(output);const d=browser.driver
 d.on('Runtime.exceptionThrown',e=>report.errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text))
 d.on('Target.attachedToTarget',e=>{if(e.targetInfo.type==='worker')workers.push(e.sessionId)})
 await d.send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true})
 await d.send('Page.navigate',{url:server.url});await d.wait('document.querySelector("#run")?.onclick',30000)
 for(const value of ['direct','one','two','arrival','midnight','direct']){
   await d.evaluate(`(()=>{const s=document.querySelector('#case');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
   const at=performance.now();await d.click('#run');await d.wait('!document.querySelector("#run").disabled',60000)
   assert.equal(await d.evaluate('document.querySelector("#output").dataset.status'),'passed')
   const result=JSON.parse(await d.evaluate('document.querySelector("#output").textContent')),sample={case:value,browserMs:performance.now()-at,workerMs:result.workerWallMs,compressedBytes:result.compressedBytes,proposals:result.result.itineraries.length,state:result.result.state}
   if(workers.length)try{sample.workerHeap=await d.send('Runtime.getHeapUsage',{},workers.at(-1))}catch(e){sample.memoryUnverified=e.message}
   report.cases.push(sample);checked('Parité complète SQLite / worker navigateur : '+value)
 }
 await d.click('#run');await d.click('#cancel');await d.wait('document.querySelector("#output").dataset.status==="cancelled"');checked('Annulation : worker arrêté et génération précédente invalidée')
 for(const width of [1440,768,390,320]){await d.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});assert.equal(await d.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await d.screenshot(resolve(output,`hybrid-${width}.png`))}checked('Laboratoire utilisable à 1440, 768, 390 et 320 px')
 assert.deepEqual(report.errors,[]);report.status='passed'
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1;if(browser)try{report.dom=await browser.driver.evaluate('document.body.innerText')}catch{}}
finally{await browser?.close();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
