import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startBrowser} from '../qa/browser-driver.mjs'
import {servePreproduction} from './serve-preproduction.mjs'
const output=resolve(`.data/step1-version-${Date.now()}`);await mkdir(output);let browser,server;const report={}
try{let bad=false;server=await servePreproduction(resolve(process.argv[2]||''),{transform:(path,bytes)=>bad&&path.endsWith('/version.json')?Buffer.from(JSON.stringify({...JSON.parse(bytes),schema:99})):bytes});browser=await startBrowser(output);const d=browser.driver;await d.send('Page.navigate',{url:server.url});await d.wait('document.querySelector(".journey-panel")');const read=()=>d.evaluate(`(async()=>{const r=await fetch('/api/gtfs/status');return{status:r.status,body:await r.json()}})()`);report.before=await read();bad=true;report.after=await read();report.rejectsIncompatibleVersion=report.after.body.status==='disconnected';report.status='observed'
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1}finally{await browser?.close();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
