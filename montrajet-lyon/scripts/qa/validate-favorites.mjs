import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { startLocalServer } from './local-server.mjs'
import { startBrowser } from './browser-driver.mjs'
import { auditJourney } from '../../tests/helpers/journeys.mjs'

const output=resolve(`.data/favorites-validation-${Date.now()}`);await mkdir(output)
const report={checks:[],performance:[],screenshots:[],errors:[],notes:['Adresses publiques de test choisies explicitement dans un profil Edge isolé, jamais les données personnelles du profil utilisateur.','Succès vérifiés contre SQLite et IGN réels. Seuls les erreurs de stockage, la référence GTFS absente et les délais d’annulation sont des tests contrôlés.']}
const checked=name=>{report.checks.push(name);console.log('OK '+name)}
const sqlite=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true})
const key='montrajet-lyon:favorites:v1'
let browser,server,d
let addressRequests=0,engineRequests=[],completed=[],tasks=[]
function attach(driver){
  d=driver;const pending=new Map()
  d.on('Network.loadingFailed',e=>{(report.networkFailures??=[]).push({error:e.errorText,canceled:e.canceled})})
  d.on('Runtime.exceptionThrown',e=>report.errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text))
  d.on('Network.requestWillBeSent',e=>{
    const url=new URL(e.request.url);if(url.pathname==='/api/mobility/addresses')addressRequests++
    if(['/api/mobility/search','/api/journeys/search'].includes(url.pathname)){
      const request={id:e.requestId,path:url.pathname,query:e.request.postData?JSON.parse(e.request.postData):Object.fromEntries(url.searchParams),started:performance.now()};pending.set(e.requestId,request);engineRequests.push(request)
    }
  })
  d.on('Network.loadingFinished',e=>{const request=pending.get(e.requestId);if(!request)return;tasks.push(d.send('Network.getResponseBody',{requestId:e.requestId}).then(value=>{
    const raw=value.base64Encoded?Buffer.from(value.body,'base64').toString():value.body;let payload
    try{payload=JSON.parse(raw)}catch{payload=raw.trim().split('\n').map(line=>JSON.parse(line)).findLast(e=>e.type==='result')?.value}
    completed.push({...request,payload,httpMs:performance.now()-request.started})
  }).catch(()=>{}))})
}
const data=()=>d.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`)
async function reloadApplication(){
  let navigated=false,loaded=false
  d.on('Page.frameNavigated',e=>{if(!e.frame.parentId&&e.frame.url.startsWith(server.url))navigated=true})
  d.on('Page.loadEventFired',()=>{if(navigated)loaded=true})
  await d.send('Page.reload');const limit=Date.now()+30000
  while(!loaded){if(Date.now()>limit)throw new Error('Rechargement du document non terminé');await delay(40)}
  await d.wait('document.querySelector(".journey-panel")',30000)
}
async function navigate(){report.navigation=await d.send('Page.navigate',{url:server.url+'/'});try{await d.wait('document.querySelector(".journey-panel")',30000)}catch(error){if(await d.evaluate('document.body.innerText.length===0')&&report.errors.length===0){report.initialBlankReload=true;await reloadApplication()}else throw error}}
async function favorites(){await d.click('nav button:nth-child(5)');await d.wait('document.querySelector(".favorites-panel")')}
async function selectOption(select,value){await d.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(select)});s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)}
async function choose(prefix,text,match){
  const before=addressRequests;await d.type(prefix+' input',text)
  await delay(500);assert.equal(addressRequests,before,'Aucun géocodage à la frappe dans l’éditeur Favoris')
  await d.click(prefix+' > .secondary')
  await d.wait(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).some(b=>b.textContent.includes(${JSON.stringify(match)}))`,20000)
  const index=await d.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).findIndex(b=>b.textContent.includes(${JSON.stringify(match)}))`)
  await d.click(prefix+` .gtfs-options li:nth-child(${index+1}) button`)
}
function audit(response){
  assert.equal(response.payload?.status,'connected',JSON.stringify(response.payload));const result=response.payload.data
  assert.ok(result.itineraries.length,'Au moins une proposition réelle, pas un résultat simulé')
  for(const item of result.itineraries){
    if(response.path==='/api/mobility/search'){
      auditJourney(sqlite,item.transitResult,item.transit)
      assert.equal(Date.parse(item.departureTime),Date.parse(item.transit.departureTime)-((item.access?.durationSeconds||0)+item.safetySeconds)*1000)
      assert.equal(Date.parse(item.arrivalTime),Date.parse(item.transit.arrivalTime)+(item.egress?.durationSeconds||0)*1000)
      assert.ok(response.query.mode==='arrival'?Date.parse(item.arrivalTime)<=Date.parse(response.query.at):Date.parse(item.departureTime)>=Date.parse(response.query.at))
      for(const path of [item.access,item.egress].filter(Boolean)){assert.equal(path.profile,'pedestrian');assert.ok(path.startSnapMeters<=25&&path.endSnapMeters<=25)}
    }else auditJourney(sqlite,result,item)
  }
  report.performance.push({kind:response.path,mode:response.query.mode,fromKind:response.query.from?.kind||'stop',toKind:response.query.to?.kind||'stop',httpMs:response.httpMs,metrics:result.metrics,proposals:result.itineraries.length})
}
async function calculate(selector){
  const before=engineRequests.length,start=Date.now();await d.click(selector)
  while(!completed.some(r=>engineRequests.slice(before).some(q=>q.id===r.id))){if(Date.now()-start>90000)throw new Error('Aucune réponse moteur reçue après l’action');await delay(50)}
  await Promise.allSettled(tasks)
  const response=completed.findLast(r=>engineRequests.slice(before).some(q=>q.id===r.id));assert.equal(engineRequests.length-before,1,'Une seule recherche moteur par action')
  audit(response)
  await d.wait('!document.querySelector(".search-button").disabled',90000)
  await d.wait(response.path==='/api/mobility/search'?'document.querySelector(".mobility-results article")':'document.querySelector(".journey-results .journey-proposal")')
  return response
}
try{
  server=await startLocalServer();browser=await startBrowser(output);attach(browser.driver);await navigate();await favorites();await delay(500)
  assert.equal(addressRequests,0);assert.equal(engineRequests.length,0);assert.ok(await d.evaluate('document.querySelector(".configure-home") && !!document.querySelector(".configure-work")'))
  checked('Favoris initialement vide, domicile et travail non imposés, aucun appel IGN ou moteur à l’ouverture')
  for(const [button,text,match,role]of [['.configure-home','100 avenue Lacassagne Lyon','100 Avenue Lacassagne 69003 Lyon','home'],['.configure-work','5 avenue des Canuts Vaulx-en-Velin','5 Avenue des Canuts 69120 Vaulx-en-Velin','work']]){
    await d.click(button);await choose('.favorite-editor .gtfs-search-field',text,match);await d.click('.favorite-editor button[type=submit]');await d.wait(`document.querySelector('[data-place-role=${role}]') && !document.querySelector('.favorite-editor')`)
  }
  let saved=await data();const home=saved.places.find(p=>p.role==='home'),work=saved.places.find(p=>p.role==='work')
  assert.equal(home.location.kind,'address');assert.equal(work.location.kind,'address');assert.ok(Number.isFinite(home.location.latitude));assert.equal(saved.version,2)
  checked('Domicile et travail créés par sélection explicite de réponses BAN réelles, coordonnées et identifiants conservés')
  await d.click('.favorite-defaults summary');await selectOption('.favorite-defaults select','departure')
  await d.type('.favorite-defaults input[type=time]','11:00')
  await d.type('.favorite-defaults input[type=number]','180');await d.click('.favorite-defaults > .secondary')
  await d.wait(`JSON.parse(localStorage.getItem('${key}')).preferences.marginSeconds===180`)
  // Native time input keyboard differs between Edge builds: verify, then use native setter if needed.
  saved=await data();if(saved.preferences.departureTime!=='11:00'){
    await d.evaluate(`(()=>{const i=document.querySelector('.favorite-defaults input[type=time]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'11:00');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}))})()`);await d.click('.favorite-defaults > .secondary')
  }
  await d.wait(`JSON.parse(localStorage.getItem('${key}')).preferences.departureTime==='11:00'`)
  const profile=browser.profile;await browser.close();browser=await startBrowser(output,profile);attach(browser.driver);await navigate()
  const beforeOpen={addresses:addressRequests,engines:engineRequests.length};await favorites();await delay(600);assert.equal(addressRequests,beforeOpen.addresses);assert.equal(engineRequests.length,beforeOpen.engines)
  saved=await data();assert.equal(saved.places.find(p=>p.role==='home').id,home.id);assert.equal(saved.places.find(p=>p.role==='work').id,work.id)
  checked('Fermeture complète puis réouverture Edge : deux lieux et préférences retrouvés sans ressaisie ni géocodage')
  await d.click('nav button:nth-child(2)');await d.date('2026-11-10T11:00');await favorites()
  const outward=await calculate('.commute-work');assert.equal(outward.query.from.id,home.location.id);assert.equal(outward.query.to.id,work.location.id);assert.equal(outward.query.marginSeconds,180);assert.equal(outward.query.at,'2026-11-10T10:00:00.000Z')
  checked('Aller au travail : une recherche réelle, date sélectionnée et marge respectées, horaires et marche audités')
  await d.type('.favorite-trip-name','Trajet de test aller');await d.click('.save-button');await d.wait(`JSON.parse(localStorage.getItem('${key}')).trips.length===1`)
  const tripsBefore=engineRequests.length;await d.click('.save-button');await delay(150);assert.equal((await data()).trips.length,1);assert.equal(engineRequests.length,tripsBefore)
  checked('Enregistrement depuis JourneyForm, nom personnalisé, aucun calcul supplémentaire et doublon empêché')
  await favorites();const requestsBeforeEdit=addressRequests
  await d.click('[data-place-role=home] .text-button');await d.type('.favorite-editor > .field input','Maison de test');await d.click('.favorite-editor button[type=submit]');await d.wait('!document.querySelector(".favorite-editor")')
  assert.equal((await data()).places.find(p=>p.role==='home').id,home.id);assert.equal(addressRequests,requestsBeforeEdit)
  const back=await calculate('.commute-home');assert.equal(back.query.from.id,work.location.id);assert.equal(back.query.to.id,home.location.id)
  checked('Lieu renommé sans géocodage ; retour calculé indépendamment dans le sens inverse et audité contre GTFS')
  await favorites()
  for(const width of [1440,768,390,320]){
    await d.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600})
    assert.ok(await d.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
    const file=`favorites-${width}.png`;await d.screenshot(resolve(output,file));report.screenshots.push(file)
  }
  await d.send('Emulation.clearDeviceMetricsOverride');checked('Favoris affichés sans débordement à 1440, 768, 390 et 320 px')
  await d.click('.favorites .text-button');await d.type('.favorite-editor > .field input','Trajet renommé de test');await selectOption('.favorite-editor .favorite-preferences select','arrival');await d.evaluate(`(()=>{const i=document.querySelectorAll('.favorite-editor input[type=time]')[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'12:00');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}))})()`);await d.click('.favorite-editor button[type=submit]');await d.wait('!document.querySelector(".favorite-editor")')
  assert.equal((await data()).trips[0].name,'Trajet renommé de test')
  await d.click('.favorites .icon-button');await d.wait('document.querySelector(".favorite-confirmation[open]")');assert.ok(await d.evaluate('!!document.activeElement.closest("dialog")'))
  await d.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await d.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await d.wait('!document.querySelector(".favorite-confirmation")');assert.equal((await data()).trips.length,1)
  checked('Modification du trajet et annulation clavier d’une suppression : focus modal, favori intact')
  const replay=await calculate('.favorites .recalculate-favorite');assert.equal(replay.query.mode,'arrival');assert.equal(replay.query.at,'2026-11-10T11:00:00.000Z')
  assert.ok((await d.evaluate('document.querySelector(".result-summary").textContent')).includes('10/11/2026'))
  await favorites();checked('Trajet fréquent relancé dans le parcours normal, sans ressaisie')
  await d.click('.add-trip');await d.type('.favorite-editor > .field input','Mixte de test')
  await selectOption('.favorite-endpoint[data-endpoint=from] > .field select',home.id)
  await selectOption('.favorite-endpoint[data-endpoint=to] .favorite-location-field select','stop')
  const mixedGeoBefore=addressRequests
  await choose('.favorite-endpoint[data-endpoint=to] .gtfs-search-field','Vaulx-en-Velin La Soie','Quai 35668 ·')
  assert.equal(addressRequests,mixedGeoBefore)
  await d.click('.favorite-editor button[type=submit]');await d.wait('!document.querySelector(".favorite-editor")')
  const mixed=(await data()).trips.find(t=>t.name==='Mixte de test');assert.ok(mixed)
  const mixedResult=await calculate(`[data-trip-id="${mixed.id}"] .recalculate-favorite`);assert.equal(mixedResult.query.from.kind,'address');assert.equal(mixedResult.query.to.id,'35668')
  await favorites();checked('Trajet mixte créé dans Favoris, recherche de quai locale sans IGN, recalcul réel adresse vers quai')
  await d.click('.add-place');await d.type('.favorite-editor > .field input','Mon arrêt exact de test')
  await selectOption('.favorite-editor .favorite-location-field select','stop')
  await choose('.favorite-editor .gtfs-search-field','Dauphiné-Lacassagne','Quai 35660 ·')
  await d.click('.favorite-editor button[type=submit]');await d.wait('!document.querySelector(".favorite-editor")')
  const stopPlace=(await data()).places.find(p=>p.location.kind==='stop');assert.equal(stopPlace.location.id,'35660')
  await d.click('.favorite-place[data-place-role=other] .secondary')
  await d.wait('document.querySelector(".journey-stop-fields input")?.value.includes("35660")')
  const stopResult=await calculate('.search-button');assert.equal(stopResult.query.fromStopId,'35660');assert.equal(stopResult.query.toStopId,'35668')
  await selectOption('.favorite-arrival',home.id)
  const stopAddress=await calculate('.search-button');assert.equal(stopAddress.query.from.id,'35660');assert.equal(stopAddress.query.to.kind,'address')
  await favorites();checked('Arrêt favori exact utilisé et sélecteur du formulaire vérifié ; trajets arrêt–arrêt et arrêt–adresse réels audités')
  // Controlled stale reference: never treated as a valid platform or a successful itinerary.
  await d.evaluate(`(()=>{const s=JSON.parse(localStorage.getItem('${key}'));s.trips.push({id:'TEST_INVALID_GTFS',name:'TEST quai disparu',from:{location:{kind:'stop',id:'TEST_MISSING_GTFS',name:'TEST quai absent'}},to:{location:{kind:'stop',id:'35668',name:'Vaulx-en-Velin La Soie'}},preferences:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});s.revision++;localStorage.setItem('${key}',JSON.stringify(s))})()`)
  await reloadApplication();await favorites();const counts={addresses:addressRequests,engines:engineRequests.length}
  await d.click('[data-trip-id=TEST_INVALID_GTFS] .recalculate-favorite');await d.wait('document.querySelector(".reference-error")?.textContent.includes("TEST_MISSING_GTFS")')
  await delay(500);assert.equal(addressRequests,counts.addresses);assert.equal(engineRequests.length,counts.engines);assert.ok((await data()).trips.some(t=>t.id==='TEST_INVALID_GTFS'))
  checked('Quai devenu invalide : favori conservé, message de correction, aucun calcul ni géocodage de substitution')
  await favorites();await d.click('[data-trip-id=TEST_INVALID_GTFS] .icon-button');await d.click('.favorite-confirmation .danger-button');await d.wait(`!JSON.parse(localStorage.getItem('${key}')).trips.some(t=>t.id==='TEST_INVALID_GTFS')`)
  checked('Suppression confirmée d’un favori uniquement après action explicite')
  await d.evaluate(`window.__favoriteSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='${key}')throw new DOMException('TEST quota','QuotaExceededError');return window.__favoriteSetItem.call(this,k,v)}`)
  const rawBefore=await d.evaluate(`localStorage.getItem('${key}')`)
  await d.click('[data-place-role=home] .text-button');await d.type('.favorite-editor > .field input','TEST stockage saturé');await d.click('.favorite-editor button[type=submit]');await d.wait('document.querySelector(".favorites-panel").textContent.includes("Impossible de modifier")')
  assert.equal(await d.evaluate(`localStorage.getItem('${key}')`),rawBefore);await d.evaluate('Storage.prototype.setItem=window.__favoriteSetItem');await d.click('.favorite-editor button[type=button]:last-child')
  checked('Erreur de stockage : données persistées intactes et modification non annoncée comme réussie')
  await d.click('.clear-favorites');await d.click('.favorite-confirmation .secondary');assert.ok((await data()).places.length===3)
  await d.evaluate("localStorage.setItem('QA_UNRELATED','TEST')")
  await d.click('.clear-favorites');await d.click('.favorite-confirmation .danger-button');await d.wait(`localStorage.getItem('${key}')===null`);assert.equal(await d.evaluate("localStorage.getItem('QA_UNRELATED')"),'TEST')
  checked('Effacement global confirmé : seule la clé Favoris est supprimée')
  await d.evaluate(`localStorage.setItem('${key}',JSON.stringify([{id:'TEST_LEGACY',departure:'Dauphiné-Lacassagne',arrival:'Vaulx-en-Velin La Soie',departureStopId:'35660',arrivalStopId:'35668'}]))`)
  await reloadApplication();await d.date('2026-11-10T11:00');await favorites();assert.ok(Array.isArray(await data()))
  await d.click('.favorites .secondary');await d.wait('document.querySelector(".journey-stop-fields input")?.value.includes("35660")')
  const legacy=await calculate('.search-button');assert.equal(legacy.query.fromStopId,'35660');assert.equal(legacy.query.toStopId,'35668')
  checked('Ancien favori migré sans écriture à l’ouverture ; quais exacts et nouveau calcul GTFS opérationnels')
  await favorites();let held=[]
  d.on('Fetch.requestPaused',async e=>held.push(e.requestId))
  await d.send('Fetch.enable',{patterns:[{urlPattern:'*/api/journeys/search*'}]})
  await d.click('.favorites .recalculate-favorite');await d.wait('document.querySelector(".cancel-search")')
  const limit=Date.now()+10000;while(!held.length){if(Date.now()>limit)throw new Error('Calcul favori non intercepté');await delay(20)}
  await d.click('.cancel-search');await d.wait('!document.querySelector(".search-button").disabled')
  for(const requestId of held)await d.send('Fetch.continueRequest',{requestId}).catch(()=>{})
  await d.send('Fetch.disable');await d.date('2026-11-10T12:00');await favorites()
  const latest=await calculate('.favorites .recalculate-favorite');assert.equal(latest.query.at,'2026-11-10T11:00:00.000Z')
  checked('Calcul lancé depuis un favori annulé puis relancé : une requête nouvelle, date récente et aucun ancien résultat substitué')
  assert.deepEqual(report.errors,[]);assert.ok(await d.evaluate('document.querySelector("footer").textContent.includes("V0.1")'))
  if(process.env.FAVORITES_SKIP_REGRESSION!=='true')for(const script of ['validate-network.mjs','validate-journeys.mjs','validate-horaires.mjs','validate-mobility.mjs','validate-traffic.mjs','validate-experience.mjs']){
    const env={...process.env,TEST_BASE_URL:server.url,TRAFFIC_SKIP_REGRESSION:'true'}
    if(script==='validate-experience.mjs')delete env.TEST_BASE_URL // This suite must observe real cold IGN phases.
    const result=await promisify(execFile)(process.execPath,[resolve('scripts/qa',script)],{env,windowsHide:true,maxBuffer:3000000,timeout:300000});console.log(result.stdout);checked('Non-régression '+script)
  }
  report.addressAutocompleteRequests=addressRequests;report.engineRequestCount=engineRequests.length;report.status='passed'
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;console.error(error);if(browser){try{report.dom=await d.evaluate('document.body.innerText');await d.screenshot(resolve(output,'failure.png'))}catch{}}}
finally{report.addressAutocompleteRequests=addressRequests;report.engineRequestCount=engineRequests.length;await browser?.close();server?.close();sqlite.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
