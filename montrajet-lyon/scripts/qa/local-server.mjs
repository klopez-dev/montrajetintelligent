import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

export async function startLocalServer() {
  if (process.env.TEST_BASE_URL) {
    const url=new URL(process.env.TEST_BASE_URL)
    if(!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('La validation cible uniquement un serveur local.')
    return {url:url.origin,close:()=>{}}
  }
  const root=fileURLToPath(new URL('../../',import.meta.url))
  const child=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','0'],{cwd:root,windowsHide:true,env:{...process.env,NO_COLOR:'1'},stdio:['ignore','pipe','pipe']})
  let text=''
  try{
    const url=await new Promise((ready,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Vite indisponible : '+text)),15000)
      child.on('error',error=>{clearTimeout(timer);reject(error)})
      child.on('exit',code=>{clearTimeout(timer);reject(new Error('Vite arrêté : '+code))})
      child.stdout.on('data',data=>{
        text+=stripVTControlCharacters(data.toString())
        const match=/http:\/\/127\.0\.0\.1:\d+/.exec(text)
        if(match){clearTimeout(timer);ready(match[0])}
      })
      child.stderr.on('data',data=>{text+=data.toString()})
    })
    return {url,close:()=>{child.kill()}}
  }catch(error){child.kill();throw error}
}
