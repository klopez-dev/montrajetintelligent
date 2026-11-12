import {spawn} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
export async function startFirefox(output){
 const profile=resolve(output,'firefox-profile');await mkdir(profile)
 const child=spawn('C:/Program Files/Mozilla Firefox/firefox.exe',['--headless','--no-remote','--profile',profile,'--remote-debugging-port','0'],{windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='',socket
 child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);child.on('error',e=>logs+=e.message)
 try{
  const deadline=Date.now()+20000;let url;while(Date.now()<deadline&&!url){url=logs.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/)?.[1];await delay(100)}if(!url)throw new Error('Firefox BiDi indisponible '+logs.slice(-1000))
  socket=new WebSocket(url.replace(/\/$/,'')+'/session');await new Promise((ok,bad)=>{socket.addEventListener('open',ok,{once:true});socket.addEventListener('error',bad,{once:true})})
  let id=0;const pending=new Map()
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data),call=pending.get(m.id);if(call){pending.delete(m.id);clearTimeout(call.timer);if(m.type==='error')call.bad(new Error(JSON.stringify(m)));else call.ok(m.result)}})
  const send=(method,params={})=>new Promise((ok,bad)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);bad(new Error('BiDi timeout '+method))},60000);pending.set(n,{ok,bad,timer});socket.send(JSON.stringify({id:n,method,params}))})
  const info=await send('session.new',{capabilities:{alwaysMatch:{}}}),{context}=await send('browsingContext.create',{type:'tab'})
  const evaluate=async expression=>{const result=await send('script.evaluate',{expression:`(async()=>JSON.stringify(await (${expression})))()`,target:{context},awaitPromise:true});if(result.type==='exception')throw new Error(JSON.stringify(result.exceptionDetails));return result.result.type==='undefined'?undefined:JSON.parse(result.result.value)}
  const driver={evaluate,click:selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`),navigate:url=>send('browsingContext.navigate',{context,url,wait:'complete'}),viewport:(width,height=1000)=>send('browsingContext.setViewport',{context,viewport:{width,height},devicePixelRatio:1}),wait:async(expression,timeout=60000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(`Boolean(${expression})`))return;await delay(40)}throw new Error('Firefox DOM condition '+expression)},screenshot:async file=>{const r=await send('browsingContext.captureScreenshot',{context,origin:'viewport'});await writeFile(file,Buffer.from(r.data,'base64'),{flag:'wx'})}}
  return{driver,version:`Firefox/${info.capabilities.browserVersion}`,close:async()=>{try{await send('session.end')}catch{}socket.close();if(child.exitCode===null)child.kill()}}
 }catch(e){socket?.close();if(child.exitCode===null)child.kill();throw e}
}
