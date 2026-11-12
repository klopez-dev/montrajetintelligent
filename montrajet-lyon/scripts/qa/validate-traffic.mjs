import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { startLocalServer } from './local-server.mjs'
import { startBrowser } from './browser-driver.mjs'

const output=resolve(`.data/traffic-validation-${Date.now()}`);await mkdir(output)
const report={checks:[],performance:[],lines:[],browserErrors:[],screenshots:[],notes:['Sources de succès réellement collectées par Node.js. États périmé/erreur injectés uniquement dans le navigateur de test.','Suites de non-régression exécutées sur le même serveur pour réutiliser le cache TCL.']}
const checked=name=>{report.checks.push(name);console.log('OK '+name)}
let server,browser
try{
  server=await startLocalServer()
  const start=performance.now(),responses=await Promise.all([fetch(server.url+'/api/traffic'),fetch(server.url+'/api/traffic')])
  const [first,coalesced]=await Promise.all(responses.map(r=>r.json()));assert.equal(first.status,'connected');assert.ok(['available','stale'].includes(first.data.state),first.data.error);assert.ok(first.data.incidents.length>0)
  report.initial=first.data;report.performance.push({kind:first.data.metrics.cacheHit?'restored-or-memory-cache':'cold',httpMs:performance.now()-start,metrics:first.data.metrics});assert.deepEqual(first.data.incidents,coalesced.data.incidents)
  assert.equal(coalesced.data.metrics.upstreamRequests,0);checked('Données officielles réelles reçues, cache et requêtes simultanées contrôlés ; état '+first.data.state)
  for(const line of ['C13','C9','C16','125','T3','A','D']){
    const t=performance.now(),body=await fetch(server.url+'/api/traffic?line='+line).then(r=>r.json());assert.equal(body.data.metrics.upstreamRequests,0)
    report.lines.push({line,covered:body.data.coverage.includes(line),incidents:body.data.incidents.length,exact:body.data.incidents.flatMap(i=>i.lines).filter(l=>l.precision==='exact').length,partial:body.data.incidents.flatMap(i=>i.lines).filter(l=>l.label===line&&l.precision==='partial').length})
    report.performance.push({kind:'warm',line,httpMs:performance.now()-t,metrics:body.data.metrics})
  }
  checked('Sept lignes prioritaires interrogées ; absence de couverture distincte d’un trafic normal')
  assert.equal((await fetch(server.url+'/api/traffic?date=2026-02-30')).status,400)
  for(const [from,to] of [['2397','36394'],['12230','36394'],['35660','35668']]){
    const route=await fetch(server.url+'/api/journeys/search?'+new URLSearchParams({fromStopId:from,toStopId:to,at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:'120',maxTransfers:'2'})).then(r=>r.json());assert.ok(route.data.itineraries.length)
    const data=await fetch(server.url+'/api/traffic/journeys',{method:'POST',body:JSON.stringify({journeys:route.data.itineraries.map(j=>j.legs)})}).then(r=>r.json())
    assert.equal(data.status,'connected');assert.equal(data.data.notices.length,route.data.itineraries.length);assert.ok(data.data.notices.flat().every(n=>n.level!=='confirmed'))
    report.performance.push({kind:'journey-check',from,to,notices:data.data.notices})
    if(from==='35660')report.expectedT3Notices=data.data.notices.flat().length
  }
  checked('Trois trajets réels Lacassagne → Soie : contrôle SQLite, aucune exclusion ni faux impact confirmé')
  browser=await startBrowser(output);const d=browser.driver
  d.on('Runtime.exceptionThrown',e=>report.browserErrors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text))
  let direct=0;d.on('Network.requestWillBeSent',e=>{if(/^https:\/\/(www\.tcl\.fr|data\.grandlyon\.com)/.test(e.request.url))direct++})
  await d.send('Page.navigate',{url:server.url+'/'});await d.wait('document.querySelector("nav button:nth-child(4)")',30000);await d.click('nav button:nth-child(4)');await d.wait('document.querySelector(".traffic-incident")',30000)
  assert.ok(await d.evaluate('document.querySelector(".traffic-freshness").textContent.includes('+JSON.stringify(first.data.state==='available'?'couverture partielle':'Données anciennes')+')'))
  await d.click('.traffic-incident summary');assert.ok(await d.evaluate('document.querySelector(".traffic-original").textContent.length>20'))
  checked('Navigateur : annonces réelles, texte officiel intégral, liens, attribution et fraîcheur')
  await d.type('.traffic-panel input[placeholder="Ex. T3"]','T3');await d.wait('document.querySelectorAll(".traffic-incident").length>0 && !document.querySelector(".traffic-panel .secondary").disabled')
  await d.type('.traffic-panel input[placeholder="Ex. T3"]','TEST-INEXISTANT');await d.wait('document.querySelector(".traffic-empty")');assert.ok(await d.evaluate('document.querySelector(".traffic-empty").textContent.includes("ne signifie pas")'))
  checked('Recherche sans résultat : aucune assimilation à un réseau sans perturbation')
  await d.type('.traffic-panel input[placeholder="Ex. T3"]','')
  await d.wait('document.querySelector(".traffic-incident") && !document.querySelector(".traffic-panel .secondary").disabled')
  await d.evaluate(`(()=>{const s=document.querySelector('.traffic-panel select');s.value='tram';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  const tramCount=first.data.incidents.filter(i=>i.lines.some(l=>l.mode==='tram')).length
  await d.wait(`document.querySelectorAll(".traffic-incident").length===${tramCount} && !document.querySelector(".traffic-panel .secondary").disabled`)
  await d.evaluate(`(()=>{const i=document.querySelector('.traffic-panel input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'2026-11-09');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  const filtered=await fetch(server.url+'/api/traffic?mode=tram&date=2026-11-09').then(r=>r.json())
  await d.wait(`document.querySelectorAll(".traffic-incident").length===${filtered.data.incidents.length} && !document.querySelector(".traffic-panel .secondary").disabled`)
  checked('Filtres réels mode tramway et date : plage exacte exclue hors date, récurrence incertaine conservée')
  await d.evaluate(`(()=>{const s=document.querySelector('.traffic-panel select');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));const i=document.querySelector('.traffic-panel input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await d.wait(`document.querySelectorAll(".traffic-incident").length===${first.data.incidents.length} && !document.querySelector(".traffic-panel .secondary").disabled`)
  for(const width of [390,320]){
    await d.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true})
    assert.ok(await d.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
    const path=`mobile-${width}.png`;await d.screenshot(resolve(output,path));report.screenshots.push(path)
  }
  assert.ok(await d.evaluate('!!document.querySelector(".traffic-coverage")'))
  report.coverageSummary=first.data.coverageSummary;report.lineCoverage=first.data.lineCoverage
  checked('Trafic mobile 320 et 390 px sans débordement')
  let mode='stale'
  d.on('Fetch.requestPaused',async e=>{
    const data={...first.data,state:mode==='unavailable'?'unavailable':'stale',error:'TEST : fournisseur TCL indisponible',validUntil:'2020-01-01T00:00:00Z',...(mode==='unavailable'?{incidents:[],fetchedAt:undefined,coverage:[]}: {})}
    await d.send('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({status:'connected',data})).toString('base64')})
  })
  await d.send('Fetch.enable',{patterns:[{urlPattern:'*/api/traffic?*'}]});await d.click('.traffic-panel .secondary')
  await d.wait('document.querySelector(".traffic-freshness").textContent.includes("Données anciennes")')
  mode='unavailable';await d.click('.traffic-panel .secondary');await d.wait('document.querySelector(".traffic-freshness").textContent.includes("Données indisponibles")')
  assert.ok(await d.evaluate('!document.querySelector(".traffic-empty")'))
  await d.send('Fetch.disable');await d.click('.traffic-panel .secondary');await d.wait('document.querySelector(".traffic-incident")')
  await d.send('Emulation.clearDeviceMetricsOverride');await d.click('nav button:nth-child(2)')
  async function selectStop(prefix,text,id){
    await d.type(prefix+' input',text)
    await d.wait(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).some(b=>b.textContent.includes(${JSON.stringify('Quai '+id+' ·')}))`,20000)
    const index=await d.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).findIndex(b=>b.textContent.includes(${JSON.stringify('Quai '+id+' ·')}))`)
    await d.click(prefix+` .gtfs-options li:nth-child(${index+1}) button`)
  }
  await selectStop('.journey-stop-fields>.gtfs-search-field:first-child','Dauphiné-Lacassagne','35660')
  await selectStop('.journey-stop-fields>.gtfs-search-field:last-child','Vaulx-en-Velin La Soie','35668')
  await d.date('2026-11-09T11:00');await d.click('.journey-panel .search-button')
  await d.wait('document.querySelector(".journey-results .journey-proposal")')
  await d.wait('document.querySelector(".journey-traffic .traffic-freshness")',55000)
  if(first.data.state==='available'){
    await d.wait(`document.querySelectorAll('.journey-traffic .traffic-notices p').length===${report.expectedT3Notices}`)
    assert.ok(await d.evaluate('!document.querySelector(".journey-traffic").textContent.includes("Impact confirmé")'))
  }

  checked('Navigateur : avertissement lié aux propositions T3 sans suppression, source officielle et absence de faux impact confirmé')
  assert.equal(direct,0);assert.deepEqual(report.browserErrors,[]);checked('États périmé et indisponible explicites ; reconnexion ; aucun appel fournisseur depuis le navigateur')
  await browser.close();browser=undefined
  report.regressionsSkipped=process.env.TRAFFIC_SKIP_REGRESSION==='true'
  if(!report.regressionsSkipped)for(const script of ['validate-network.mjs','validate-journeys.mjs','validate-horaires.mjs','validate-mobility.mjs']){
    const result=await promisify(execFile)(process.execPath,[resolve('scripts/qa',script)],{env:{...process.env,TEST_BASE_URL:server.url},windowsHide:true,maxBuffer:3000000,timeout:240000});console.log(result.stdout);checked('Non-régression '+script)
  }
  report.final=await fetch(server.url+'/api/traffic').then(r=>r.json());report.status='passed'
}catch(error){report.status='failed';report.error=error.stack;console.error(error);process.exitCode=1;if(browser){try{report.dom=await browser.driver.evaluate('document.body.innerText');await browser.driver.screenshot(resolve(output,'failure.png'))}catch{}}}
finally{await browser?.close();server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
