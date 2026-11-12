import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { startLocalServer } from './local-server.mjs'
import { startBrowser } from './browser-driver.mjs'

const output=resolve(`.data/experience-validation-${Date.now()}`);await mkdir(output)
const report={checks:[],errors:[],screenshots:[],notes:['Réponses de succès : API et SQLite réelles. Seules les pannes et attentes de transport sont injectées via DevTools, jamais les itinéraires.']}
const checked=name=>{report.checks.push(name);console.log('OK '+name)}
let server,browser
try{
  server=await startLocalServer();browser=await startBrowser(output);const d=browser.driver
  d.on('Runtime.exceptionThrown',e=>report.errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text))
  await d.send('Page.navigate',{url:server.url+'/'})
  try{await d.wait('document.querySelector(".journey-panel")',30000)}catch(error){
    if(await d.evaluate('document.body.innerText.trim()'))throw error
    await d.reload();await d.wait('document.querySelector(".journey-panel")',30000)
  }
  const from='.journey-stop-fields>.gtfs-search-field:first-child',to='.journey-stop-fields>.gtfs-search-field:last-child'
  async function select(prefix,text,match){
    await d.type(prefix+' input',text)
    await d.wait(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).some(b=>b.textContent.includes(${JSON.stringify(match)}))`,20000)
    const index=await d.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).findIndex(b=>b.textContent.includes(${JSON.stringify(match)}))`)
    await d.click(prefix+` .gtfs-options li:nth-child(${index+1}) button`)
  }
  const idle=()=>d.wait('!document.querySelector(".search-button").disabled',90000)
  await select(from,'Dauphiné-Lacassagne','Quai 35660 ·');await select(to,'Vaulx-en-Velin La Soie','Quai 35668 ·');await d.date('2026-11-09T11:00')
  await d.click('.search-button');await idle();await d.wait('document.querySelector(".journey-results .journey-proposal")')
  const initial=await d.evaluate('document.querySelector(".result-summary").textContent')
  checked('Itinéraire GTFS réel T3 affiché avant les tests de conservation')

  // A controlled delay lets us inspect cancellation and mobile without fabricating a result.
  let mode='hold',held=[],count=0
  d.on('Fetch.requestPaused',async e=>{
    count++
    if(mode==='hold'){held.push(e.requestId);return}
    if(mode==='empty-provider-error') { await d.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({status:'connected',data:{state:'no_journey',itineraries:[],providerIssues:[{source:'IGN',message:'IGN TEST indisponible, aucun accès confirmé'}]}})).toString('base64')});return }
    if(mode==='error')await d.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({error:'IGN HTTP 503 — panne de transport TEST contrôlée.'})).toString('base64')})
    else if(mode==='network')await d.send('Fetch.failRequest',{requestId:e.requestId,errorReason:'ConnectionFailed'})
    else await d.send('Fetch.continueRequest',{requestId:e.requestId})
  })
  await d.send('Fetch.enable',{patterns:[{urlPattern:'*/api/journeys/search*'},{urlPattern:'*/api/mobility/search'}]})
  const previous=count
  await d.evaluate(`(()=>{const f=document.querySelector('.journey-panel form');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})()`)
  await d.wait('document.querySelector(".cancel-search")');await delay(200);assert.equal(count-previous,1)
  assert.equal(await d.evaluate('document.querySelector(".previous-result-note").textContent.endsWith('+JSON.stringify(initial)+')'),true)
  assert.equal(await d.evaluate('document.querySelector("[data-server-stage]")===null'),true)
  checked('Deux soumissions synchrones : une seule requête ; aucune fausse étape avant réponse serveur')
  for(const width of [390,320]){
    await d.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true})
    assert.ok(await d.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
    assert.ok(await d.evaluate('document.querySelector(".cancel-search").getBoundingClientRect().height>=44'))
    const file=`mobile-${width}-pending.png`;await d.screenshot(resolve(output,file));report.screenshots.push(file)
  }
  await d.send('Emulation.clearDeviceMetricsOverride')
  const cancelStart=performance.now();await d.click('.cancel-search');await idle();report.cancelFeedbackMs=performance.now()-cancelStart
  assert.ok(await d.evaluate('!!(document.querySelector(".journey-results") && document.querySelector(".previous-result-note"))'))
  for(const requestId of held)await d.send('Fetch.continueRequest',{requestId}).catch(()=>{});held=[]
  await delay(400)
  assert.ok(await d.evaluate('document.querySelector(".previous-result-note").textContent.endsWith('+JSON.stringify(initial)+')'))
  checked('Annulation immédiate : résultats antérieurs conservés, ancienne réponse sans effet, mobile 320/390 px')

  mode='error';await d.click('.search-button');await idle()
  await d.wait('document.querySelector(".journey-panel [role=alert]")?.textContent.includes("IGN HTTP 503")')
  assert.ok(await d.evaluate('!!(document.querySelector(".journey-results") && document.querySelector(".previous-result-note"))'))
  mode='network';await d.click('.search-button');await idle();await d.wait('document.querySelector(".journey-panel [role=alert]")')
  assert.ok(await d.evaluate('!!(document.querySelector(".journey-results") && document.querySelector(".previous-result-note"))'))
  checked('Erreur fournisseur et panne réseau : origine explicite ou transport indisponible, résultats valides conservés')

  mode='hold';await d.click('.search-button');await d.wait('document.querySelector(".cancel-search")');await delay(100)
  await d.date('2026-11-09T12:00');await idle()
  mode='';await d.click('.search-button');await idle();await d.wait('document.querySelector(".result-summary")?.textContent.includes("12:00")')
  const fresh=await d.evaluate('document.querySelector(".result-summary").textContent')
  for(const requestId of held)await d.send('Fetch.continueRequest',{requestId}).catch(()=>{});held=[]
  await delay(400);assert.equal(await d.evaluate('document.querySelector(".result-summary").textContent'),fresh)
  checked('Recherche remplacée par une nouvelle date : seul le résultat le plus récent est affiché')
  await d.send('Fetch.disable')

  await select(from,'100 avenue Lacassagne Lyon','100 Avenue Lacassagne 69003 Lyon');await d.date('2026-11-09T11:00')
  await d.click('.search-button');await d.wait('document.querySelector("[data-server-stage=walking]")',20000)
  await d.click('.cancel-search');await idle();assert.ok(await d.evaluate('!!document.querySelector(".previous-result-note")'))
  checked('Annulation réelle pendant les parcours IGN, itinéraires précédents préservés')
  await d.click('.search-button');await idle();await d.wait('document.querySelector(".mobility-results article")',90000)
  assert.ok(await d.evaluate('document.querySelector(".result-summary").textContent.includes("100 Avenue Lacassagne")'))
  checked('Relance après annulation : parcours IGN réels et résultat GTFS porte-à-porte reçus')
  await d.send('Fetch.enable',{patterns:[{urlPattern:'*/api/mobility/search'}]});mode='empty-provider-error'
  await d.click('.search-button');await idle()
  await d.wait('document.querySelector(".journey-panel [role=alert]")?.textContent.includes("IGN TEST indisponible")')
  assert.ok(await d.evaluate('!!document.querySelector(".mobility-results article") && !!document.querySelector(".previous-result-note")'))
  await d.send('Fetch.disable');mode=''
  checked('Échec des accès IGN dans une réponse partielle : ne remplace pas les itinéraires valides par une liste vide')
  for(const width of [390,320]){
    await d.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true})
    assert.ok(await d.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
    const file=`mobile-${width}-result.png`;await d.screenshot(resolve(output,file));report.screenshots.push(file)
  }
  assert.deepEqual(report.errors,[]);assert.ok(await d.evaluate('document.querySelector("footer").textContent.includes("V0.1")'))
  checked('Résultats mobiles sans débordement ; aucune exception JavaScript ; version V0.1')
  report.status='passed'
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;console.error(error);if(browser){try{report.dom=await browser.driver.evaluate('document.body.innerText');await browser.driver.screenshot(resolve(output,'failure.png'))}catch{}}}
finally{await browser?.close();server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
