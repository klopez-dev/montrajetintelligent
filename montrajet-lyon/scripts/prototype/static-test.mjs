import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startBrowser} from '../qa/browser-driver.mjs'
import {startStatic} from './static-server.mjs'
const output=resolve(`.data/hybrid-static-test-${Date.now()}`);await mkdir(output)
const directory=resolve(process.argv[2]||''),manifest=JSON.parse(await readFile(resolve(directory,'prototype-data/manifest.json'),'utf8')),control={},report={checks:[],errors:[]};let server,browser
try{
 server=await startStatic(directory,control);browser=await startBrowser(output);const d=browser.driver
 async function reload(){await d.send('Page.navigate',{url:server.url+'&r='+Date.now()});await d.wait('document.querySelector("#run")?.onclick')}
 async function run(status='computed'){await d.click('#run');await d.wait('!document.querySelector("#run").disabled',60000);assert.equal(await d.evaluate('document.querySelector("#output").dataset.status'),status)}
 await reload();await run();report.checks.push('Built static worker returns official GTFS itineraries without reference API')
 for(const fault of ['manifest.json',manifest.catalog.file,manifest.days['2026-11-09'].file]){control.fail=fault;await reload();await run('failed');assert.match(await d.evaluate('document.querySelector("#output").textContent'),/HTTP 503/);report.checks.push('Explicit 503: '+fault)}control.fail=null
 control.corrupt=manifest.days['2026-11-09'].file;await reload();await run('failed');assert.match(await d.evaluate('document.querySelector("#output").textContent'),/Empreinte/);report.checks.push('Corrupt day rejected');control.corrupt=null
 control.delayMs=2000;await reload();const requestCount=server.requests.length;await d.click('#run');const deadline=Date.now()+10000;while(!server.requests.slice(requestCount).some(p=>p.includes('manifest.json'))&&Date.now()<deadline)await new Promise(ok=>setTimeout(ok,20));assert.ok(server.requests.slice(requestCount).some(p=>p.includes('manifest.json')),'Manifest request must actually be in flight before cancellation');await d.click('#cancel');assert.equal(await d.evaluate('document.querySelector("#output").dataset.status'),'cancelled');await new Promise(ok=>setTimeout(ok,2200));assert.equal(await d.evaluate('document.querySelector("#output").dataset.status'),'cancelled');report.checks.push('Cold load cancellation during confirmed in-flight manifest request ignores late response');control.delayMs=0
 await reload();await d.evaluate('window.Worker=class{constructor(){throw new Error("Web Worker indisponible (test)")}}');await run('failed');report.checks.push('Unavailable Worker produces explicit failure, no fictitious result')
 report.slowNetwork={delayMsPerDataResponse:100,bytesPerSecond:375000,repetitions:[]};control.delayMs=100;control.throughputBytes=375000
 for(let i=0;i<3;i++){await reload();const at=performance.now();await run();const data=JSON.parse(await d.evaluate('document.querySelector("#output").textContent'));report.slowNetwork.repetitions.push({wallMs:performance.now()-at,workerMs:data.workerWallMs})}control.delayMs=0;control.throughputBytes=0;report.checks.push('Three locally rate-limited cold loads, 375000 bytes/s + 100ms per data response')
 for(const width of [390,320]){await d.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});assert.equal(await d.evaluate('document.documentElement.scrollWidth>innerWidth'),false);await d.screenshot(resolve(output,`static-${width}.png`))}report.checks.push('Built laboratory mobile 390 / 320')
 assert.equal(server.requests.some(p=>p.includes('/prototype/reference')),false);report.requests=server.requests;report.status='passed'
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;console.error(e)}finally{await browser?.close();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
