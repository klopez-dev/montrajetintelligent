import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { startLocalServer } from './local-server.mjs'
import { startBrowser } from './browser-driver.mjs'
import { auditJourney } from '../../tests/helpers/journeys.mjs'

const root=fileURLToPath(new URL('../../',import.meta.url))
const output=resolve(root,`.data/routing-validation-${Date.now()}`)
await mkdir(output)
const sqlite=new DatabaseSync(process.env.GTFS_DB||resolve(root,'.data/gtfs.sqlite'),{readOnly:true})
const report={startedAt:new Date().toISOString(),checks:[],apiCases:[],performance:[],screenshots:[],errors:[],browserResponses:[]}
const checked=(name,details={})=>{report.checks.push({name,...details});console.log('OK '+name)}
let server,browser
try{
  server=await startLocalServer();report.baseUrl=server.url
  async function search(changes={}){
    const query={fromStopId:'2397',toStopId:'36394',at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:'120',maxTransfers:'1',...changes}
    const start=performance.now()
    const response=await fetch(server.url+'/api/journeys/search?'+new URLSearchParams(query))
    assert.equal(response.status,200)
    const payload=await response.json();assert.equal(payload.status,'connected')
    const milliseconds=performance.now()-start
    payload.data.itineraries.forEach(j=>auditJourney(sqlite,payload.data,j))
    return {query,result:payload.data,httpMs:milliseconds}
  }
  const cases=[['Place Henri','2397','36394'],['Domrémy-Lacassagne','12230','36394'],['Dauphiné-Lacassagne','35660','35668']]
  for(const [name,fromStopId,toStopId] of cases)for(const mode of ['departure','arrival']){
    const proof=await search({fromStopId,toStopId,mode,order:mode==='arrival'?'departure':'arrival'})
    assert.equal(proof.result.state,'ok');assert.ok(proof.result.itineraries.length>1)
    report.apiCases.push({name,...proof})
    checked(`${name} → La Soie : ${mode}, horaires et correspondances vérifiés contre SQLite`,{proposals:proof.result.itineraries.length})
  }
  for(const changes of [{toStopId:'35668'},{at:'2028-01-01T00:00:00Z'}]){
    const proof=await search(changes);assert.equal(proof.result.itineraries.length,0);report.apiCases.push(proof)
  }
  checked('Aucun trajet fabriqué quand le lien orienté manque ou la date est hors validité')
  for(const [name,fromStopId,toStopId] of cases){
    const samples=[]
    for(let i=0;i<5;i++){
      const proof=await search({fromStopId,toStopId})
      samples.push({httpMs:proof.httpMs,serverMs:proof.result.metrics.durationMs,sqlQueries:proof.result.metrics.sqlQueries,legCount:proof.result.metrics.legCount})
    }
    const sorted=samples.map(s=>s.httpMs).sort((a,b)=>a-b)
    report.performance.push({name,iterations:samples.length,medianHttpMs:sorted[Math.floor(sorted.length/2)],maxHttpMs:sorted.at(-1),samples})
  }
  checked('Temps de réponse mesurés : cinq requêtes HTTP chaudes par trajet')

  browser=await startBrowser(output);report.browser=browser.version
  const d=browser.driver,requests=new Map(),bodyTasks=[]
  let supplierCalls=0
  d.on('Runtime.exceptionThrown',event=>report.errors.push(event.exceptionDetails.exception?.description||event.exceptionDetails.text))
  d.on('Network.requestWillBeSent',event=>{
    if(event.request.url.startsWith('https://data.grandlyon.com/'))supplierCalls++
    if(event.request.url.startsWith(server.url+'/api/journeys/'))requests.set(event.requestId,{url:event.request.url})
  })
  d.on('Network.responseReceived',event=>{const request=requests.get(event.requestId);if(request)request.status=event.response.status})
  d.on('Network.loadingFinished',event=>{
    const request=requests.get(event.requestId);if(!request)return
    bodyTasks.push(d.send('Network.getResponseBody',{requestId:event.requestId}).then(value=>{
      try{report.browserResponses.push({...request,body:(()=>{const raw=value.base64Encoded?Buffer.from(value.body,'base64').toString():value.body;try{return JSON.parse(raw)}catch{return raw.trim().split('\n').map(line=>JSON.parse(line)).findLast(event=>event.type==='result')?.value}})()})}catch{/* Réponse volontairement invalide. */}
    }).catch(()=>{}))
  })
  await d.send('Page.navigate',{url:server.url+'/'})
  await d.wait('document.querySelector(".journey-panel")',30000)
  await d.click('nav button:nth-child(2)')
  const from='.journey-stop-fields>.gtfs-search-field:first-child',to='.journey-stop-fields>.gtfs-search-field:last-child'
  async function select(prefix,text,id){
    await d.type(prefix+' input',text)
    await d.wait(`document.querySelector(${JSON.stringify(prefix+' .gtfs-options button')})`)
    const index=await d.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).findIndex(b=>b.querySelector('small').textContent.startsWith('Quai '+${JSON.stringify(id)}+' ·'))`)
    assert.ok(index>=0,`Quai ${id} proposé pour ${text}`)
    await d.click(prefix+` .gtfs-options li:nth-child(${index+1}) button`)
  }
  async function setMode(value){
    await d.evaluate(`(()=>{const s=document.querySelector('.journey-panel form select');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  }
  async function submit(){
    await d.evaluate(`(()=>{const s=document.querySelector('select[aria-label="Correspondances maximum"]');if(s&&s.value!=='1'){s.value='1';s.dispatchEvent(new Event('change',{bubbles:true}))}})()`)
    const previous=report.browserResponses.length
    await d.click('.journey-panel .search-button')
    // A cached reply can finish before the next DOM poll; retained results already exist.
    // Wait for the new captured response instead of treating the previous DOM as completion.
    const responseDeadline=Date.now()+30000
    while(!report.browserResponses.slice(previous).some(r=>new URL(r.url).pathname==='/api/journeys/search'&&r.status===200&&r.body?.data)){
      await Promise.allSettled(bodyTasks)
      if(Date.now()>responseDeadline)break
      await delay(20)
    }
    await d.wait(`document.querySelector('.journey-results') && !document.querySelector('.journey-panel .search-button').disabled`)
    await Promise.allSettled(bodyTasks)
    const response=report.browserResponses.slice(previous).findLast(r=>new URL(r.url).pathname==='/api/journeys/search'&&r.status===200&&r.body?.data)
    assert.ok(response,'Réponse du calculateur réellement reçue par React')
    const data=response.body.data
    data.itineraries.forEach(j=>auditJourney(sqlite,data,j))
    const times=await d.evaluate(`Array.from(document.querySelectorAll('.journey-proposal')).map(li=>Array.from(li.querySelectorAll('time')).map(t=>t.getAttribute('datetime')))`)
    assert.deepEqual(times,data.itineraries.map(j=>[j.departureTime,j.arrivalTime]))
    return data
  }
  await d.click('.journey-panel .search-button')
  await d.wait(`document.querySelector('.journey-panel [role="alert"]')?.textContent.includes('Sélectionnez explicitement')`)
  checked('Navigateur : aucune recherche à partir de noms non sélectionnés')
  await select(from,'Place Henri','2397');await select(to,'Vaulx-en-Velin La Soie','36394')
  await d.date('2026-11-09T11:00')
  let data=await submit();assert.equal(data.state,'ok');assert.ok(data.itineraries.length>1)
  assert.ok((await d.evaluate(`document.querySelector('.journey-results').textContent`)).includes('durée seule non détaillée'))
  checked('Navigateur : Place Henri → La Soie, bus/métro et minimum officiel visibles')
  await d.click('.journey-proposal:nth-child(2) .journey-detail summary')
  assert.equal(await d.evaluate(`document.querySelector('.journey-proposal:nth-child(2) .journey-detail').open`),true)
  await d.click('.journey-proposal:nth-child(2) .journey-detail summary')
  checked('Navigateur : détails des propositions consultables individuellement')
  await delay(300)
  let capture=resolve(output,'itineraire-correspondance-desktop.png');await d.screenshot(capture);report.screenshots.push(capture)

  await d.click('.journey-swap')
  assert.ok((await d.evaluate(`document.querySelector(${JSON.stringify(from+' input')}).value`)).includes('36394'))
  await d.click('.journey-swap')
  checked('Navigateur : inversion des noms ET des identifiants de quais')
  await setMode('arrival');await d.date('2026-11-09T12:00')
  data=await submit();assert.ok(data.itineraries.every(j=>Date.parse(j.arrivalTime)<=Date.parse('2026-11-09T11:00:00Z')))
  checked('Navigateur : Arriver avant respecte l’échéance')

  await d.click('.journey-panel .save-button')
  await d.wait(`document.querySelector('.journey-panel .message[role="status"]')?.textContent.includes('ajouté')`)
  const saved=await d.evaluate(`JSON.parse(localStorage.getItem('montrajet-lyon:favorites:v1'))`)
  assert.equal(saved.version,2);assert.equal(saved.trips[0].from.location.id,'2397');assert.equal(saved.trips[0].to.location.id,'36394')
  await d.reload()
  await d.wait('document.querySelector("nav button:nth-child(5)")')
  await d.click('nav button:nth-child(5)')
  await d.wait('document.querySelector(".favorites .secondary")')
  await d.click('.favorites .secondary')
  await d.wait(`document.querySelector(${JSON.stringify(from+' input')})?.value.includes('2397') && document.querySelector(${JSON.stringify(to+' input')})?.value.includes('36394')`)
  checked('Navigateur : favori persistant, rechargement et réutilisation des quais exacts')
  await d.click('nav button:nth-child(5)')
  await d.wait('document.querySelector(".favorites .icon-button")')
  await d.click('.favorites .icon-button')
    await d.wait('document.querySelector(".favorite-confirmation[open]")')
    await d.click('.favorite-confirmation .danger-button')
  await d.wait('document.querySelector(".empty")')
  assert.deepEqual(await d.evaluate(`JSON.parse(localStorage.getItem('montrajet-lyon:favorites:v1')).trips`),[])
  await d.click('nav button:nth-child(2)')
  await d.wait(`document.querySelector(${JSON.stringify(from+' input')})?.value.includes('2397') && document.querySelector(${JSON.stringify(to+' input')})?.value.includes('36394')`)
  checked('Navigateur : suppression d’un favori dans le profil de test, sans perdre le trajet en cours')
  await d.date('2026-11-09T11:00')
  await select(from,'Domrémy-Lacassagne','12230')
  data=await submit();assert.equal(data.state,'ok')
  checked('Navigateur : Domrémy-Lacassagne → La Soie')
  await select(from,'Dauphiné-Lacassagne','35660');await select(to,'Vaulx-en-Velin La Soie','35668')
  data=await submit();assert.ok(data.itineraries.every(j=>j.transfers===0&&j.legs[0].routeId==='T3'))
  checked('Navigateur : Dauphiné-Lacassagne → La Soie, directs T3')

  await d.evaluate(`(()=>{const s=Array.from(document.querySelectorAll('.journey-panel select')).find(s=>Array.from(s.options).some(o=>o.value==='duration'));s.value='duration';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  data=await submit();assert.equal(data.query.order,'duration')
  assert.ok(data.itineraries.every((j,i,a)=>!i||a[i-1].durationSeconds<=j.durationSeconds))
  checked('Navigateur : classement par durée')

  await select(from,'Place Henri','2397')
  data=await submit();assert.equal(data.state,'no_journey')
  checked('Navigateur : absence de lien sûr, pas d’itinéraire inventé')
  await d.date('2028-01-01T11:00');data=await submit();assert.equal(data.state,'outside_validity')
  checked('Navigateur : date hors validité')

  await d.date('2026-10-25T02:30')
  await d.wait(`Array.from(document.querySelectorAll('.journey-panel option')).some(o=>o.textContent.includes('Seconde occurrence'))`)
  await d.evaluate(`(()=>{const s=Array.from(document.querySelectorAll('.journey-panel select')).find(s=>Array.from(s.options).some(o=>o.textContent.includes('Seconde occurrence')));s.value='1';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  data=await submit();assert.equal(data.query.at,'2026-10-25T01:30:00.000Z');assert.equal(data.state,'outside_validity')
  checked('Navigateur : heure répétée, seconde occurrence explicitement conservée')
  await d.date('2026-03-29T02:30')
  const beforeInvalid=report.browserResponses.filter(r=>new URL(r.url).pathname==='/api/journeys/search').length
  await d.click('.journey-panel .search-button')
  await d.wait(`document.querySelector('.journey-panel [role="alert"]')?.textContent.includes('changement d’heure')`)
  assert.equal(report.browserResponses.filter(r=>new URL(r.url).pathname==='/api/journeys/search').length,beforeInvalid)
  checked('Navigateur : heure locale inexistante refusée sans appel de calcul')

  await select(from,'Dauphiné-Lacassagne','35660');await d.date('2026-11-09T11:00')
  let mode='slow',release
  d.on('Fetch.requestPaused',async event=>{
    if(mode==='slow')release=()=>d.send('Fetch.continueRequest',{requestId:event.requestId})
    else if(mode==='error')await d.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({error:'Erreur calculateur de validation contrôlée.'})).toString('base64')})
    else await d.send('Fetch.continueRequest',{requestId:event.requestId})
  })
  await d.send('Fetch.enable',{patterns:[{urlPattern:server.url+'/api/journeys/search*',requestStage:'Request'}]})
  await d.click('.journey-panel .search-button')
  await d.wait(`document.querySelector('.journey-panel .search-button').disabled && document.querySelector('.journey-panel .search-button').textContent.includes('Calcul')`)
  while(!release)await delay(20)
  await release();mode='';await d.wait('document.querySelector(".journey-results") && !document.querySelector(".search-button").disabled')
  checked('Navigateur : calcul en cours et double soumission empêchée')
  mode='error';await d.click('.journey-panel .search-button')
  await d.wait(`document.querySelector('.journey-panel [role="alert"]')?.textContent.includes('Erreur calculateur de validation')`)
  assert.ok(await d.evaluate(`!!(document.querySelector('.journey-results') && document.querySelector('.previous-result-note'))`))
  mode='';await d.send('Fetch.disable');await submit()
  checked('Navigateur : erreur serveur explicite, anciens résultats conservés et identifiés')

  for(const width of [390,320]){
    await d.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true})
    await delay(150)
    assert.ok(await d.evaluate(`document.documentElement.scrollWidth<=${width}`),'Pas de débordement horizontal')
    await submit()
    capture=resolve(output,`itineraire-direct-${width}.png`);await d.screenshot(capture);report.screenshots.push(capture)
    checked(`Navigateur : recherche complète et affichage à ${width}px`)
  }
  await Promise.allSettled(bodyTasks)
  assert.equal(supplierCalls,0);assert.deepEqual(report.errors,[])
  assert.ok((await d.evaluate('document.querySelector("footer").textContent')).includes('V0.1'))
  checked('Aucune exception JavaScript, version V0.1 et temps réel non sollicité')
  report.status='passed';report.finishedAt=new Date().toISOString()
  console.log('Rapport : '+output)
}catch(error){
  report.status='failed';report.failure=error.stack||String(error);console.error(error);process.exitCode=1
  if(browser){try{await browser.driver.screenshot(resolve(output,'failure.png'));report.failureDom=await browser.driver.evaluate('document.body.innerText')}catch{/* Meilleur effort. */}}
}finally{
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'})
  if(browser)await browser.close()
  server?.close();sqlite.close()
}
