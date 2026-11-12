import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { stripVTControlCharacters } from 'node:util'

const root=fileURLToPath(new URL('../',import.meta.url))
test('Configuration RT invalide : Vite, API GTFS et repli restent accessibles',{skip:!existsSync(resolve(root,'.data/gtfs.sqlite'))},async t=>{
  const child=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','0'],{cwd:root,windowsHide:true,env:{...process.env,GRANDLYON_TIMEOUT_MS:'NaN',NO_COLOR:'1'},stdio:['ignore','pipe','pipe']})
  t.after(()=>{child.kill()})
  let text=''
  const base=await new Promise((ready,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Vite indisponible : '+text)),15000)
    child.on('error',reject)
    child.on('exit',code=>{if(!text.includes('Local:'))reject(new Error('Vite arrêté : '+code))})
    child.stderr.on('data',data=>{text+=data.toString()})
    child.stdout.on('data',data=>{
      text+=stripVTControlCharacters(data.toString())
      const match=/http:\/\/127\.0\.0\.1:\d+/.exec(text)
      if(match){clearTimeout(timer);ready(match[0])}
    })
  })
  const gtfs=await(await fetch(base+'/api/gtfs/status')).json()
  assert.equal(gtfs.status,'connected')
  const stops=await(await fetch(base+'/api/gtfs/stops?q=Place%20Henri&lineId=C13')).json()
  assert.ok(stops.data.length>0)
  const rt=await(await fetch(base+'/api/realtime/passages?'+new URLSearchParams({lineId:'C13',stopId:stops.data[0].id}))).json()
  assert.equal(rt.reason,'configuration_invalid');assert.equal(rt.state,'unavailable');assert.deepEqual(rt.estimates,[])
  const passages=await(await fetch(base+'/api/gtfs/passages?'+new URLSearchParams({lineId:'C13',stopId:stops.data[0].id,at:'2026-11-09T10:00:00Z'}))).json()
  assert.ok(passages.data.passages.length>0)
})
