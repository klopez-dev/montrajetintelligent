import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startBrowser} from '../qa/browser-driver.mjs'
import {startPrototype} from './serve.mjs'
const output=resolve(`.data/hybrid-fallback-${Date.now()}`);await mkdir(output);let browser,server;const report={checks:[]}
try{
 const control={fail:'manifest.json'};server=await startPrototype(resolve(process.argv[2]||''),control);browser=await startBrowser(output);const d=browser.driver
 const reload=async()=>{await d.send('Page.navigate',{url:server.url+'?t='+Date.now()});await d.wait('document.querySelector("#run")?.onclick')}
 await reload();await d.click('#run');await d.wait('document.querySelector("#output").dataset.status==="failed"');await d.wait('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("référence SQLite")&&!b.hidden)');await d.evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("référence SQLite")).click()');assert.equal(await d.evaluate('document.querySelector("#output").dataset.status'),'fallback');const result=JSON.parse(await d.evaluate('document.querySelector("#output").textContent'));assert.ok(result.result.itineraries.length);report.checks.push('HTTP503 worker data: explicit fallback button shows SQLite result labelled as such')
 control.fail=null;await reload();await d.evaluate(`window.Worker=class extends Worker{constructor(){super(URL.createObjectURL(new Blob(['throw new Error("QA worker crash")'],{type:'text/javascript'})))}}`);await d.click('#run');await d.wait('document.querySelector("#output").dataset.status==="failed"');assert.match(await d.evaluate('document.querySelector("#output").textContent'),/worker expérimental a échoué/);report.checks.push('Real isolated worker execution failure reaches onerror; controls reenabled')
 report.status='passed'
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1}finally{await browser?.close();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
