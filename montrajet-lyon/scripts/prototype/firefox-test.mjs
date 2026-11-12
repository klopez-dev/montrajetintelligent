import {spawn} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createNetworkPlanner} from '../../server/journeys/network.ts'
import {startStatic} from './static-server.mjs'
const output=resolve(`.data/hybrid-firefox-${Date.now()}`);await mkdir(output);await mkdir(resolve(output,'profile'))
const report={checks:[],notes:['Firefox WebDriver BiDi; DOM clicks, no physical touch; memory unavailable via this harness.']};let server,child,socket,logs=''
const sqlite=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),reference=createNetworkPlanner({all:async(s,p=[])=>sqlite.prepare(s).all(...p)}),canonical=r=>({state:r.state,itineraries:r.itineraries,scope:r.scope,warnings:r.warnings})
try{
 server=await startStatic(resolve(process.argv[2]||''))
 child=spawn('C:/Program Files/Mozilla Firefox/firefox.exe',['--headless','--no-remote','--profile',resolve(output,'profile'),'--remote-debugging-port','0'],{windowsHide:true,stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);child.on('error',e=>logs+=e.message)
 const deadline=Date.now()+20000;let url
 while(Date.now()<deadline&&!url){url=logs.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/)?.[1];await delay(100)}
 if(!url)throw new Error('Firefox BiDi absent: '+logs.slice(-2000))
 socket=new WebSocket(url.endsWith('/session')?url:url.replace(/\/$/,'')+'/session');await new Promise((ok,bad)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',bad,{once:true})})
 let id=0;const pending=new Map()
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);const call=pending.get(m.id);if(call){pending.delete(m.id);clearTimeout(call.timer);if(m.type==='error')call.bad(new Error(JSON.stringify(m)));else call.ok(m.result)}})
 function send(method,params={}){return new Promise((ok,bad)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);bad(new Error('BiDi timeout: '+method))},30000);pending.set(n,{ok,bad,timer});socket.send(JSON.stringify({id:n,method,params}))})}
 const session=await send('session.new',{capabilities:{alwaysMatch:{acceptInsecureCerts:false}}});report.capabilities=session.capabilities
 const {context}=await send('browsingContext.create',{type:'tab'})
 const evaluate=async expression=>{const r=await send('script.evaluate',{expression:`(async()=>JSON.stringify(await (${expression})))()`,target:{context},awaitPromise:true});if(r.type==='exception')throw new Error(JSON.stringify(r.exceptionDetails));return JSON.parse(r.result.value)}
 await send('browsingContext.navigate',{context,url:server.url,wait:'complete'})
 async function wait(expression){const end=Date.now()+60000;while(Date.now()<end){if(await evaluate(expression))return;await delay(50)}throw new Error('Firefox condition: '+expression)}
 await wait('Boolean(document.querySelector("#run")?.onclick)')
 for(const value of ['direct','one','two','arrival','midnight']){await evaluate(`(()=>{document.querySelector('#case').value=${JSON.stringify(value)};document.querySelector('#run').click();return true})()`);await wait('!document.querySelector("#run").disabled');assert.equal(await evaluate('document.querySelector("#output").dataset.status'),'computed');const r=JSON.parse(await evaluate('document.querySelector("#output").textContent'));assert.ok(r.result.itineraries.length);assert.deepEqual(canonical(r.result),canonical(await reference.search(r.result.query)));report.checks.push({case:value,parity:true,workerMs:r.workerWallMs,proposals:r.result.itineraries.length})}
 for(const width of [390,320]){await send('browsingContext.setViewport',{context,viewport:{width,height:900},devicePixelRatio:1});assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false)}
 report.checks.push('Firefox viewport 390 / 320 without overflow')
 await send('browsingContext.reload',{context,wait:'complete'});await wait('Boolean(document.querySelector("#run")?.onclick)');assert.equal(await evaluate('document.querySelector("#output").dataset.status'),'idle');report.status='passed';await send('session.end')
}catch(e){report.status='failed';report.error=e.stack;report.logs=logs.slice(-3000);console.error(e);process.exitCode=1}
finally{sqlite.close();socket?.close();if(child&&child.exitCode===null)child.kill();await server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
