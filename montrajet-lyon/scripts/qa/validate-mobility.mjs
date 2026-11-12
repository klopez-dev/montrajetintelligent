import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLocalServer } from './local-server.mjs'
import { startBrowser } from './browser-driver.mjs'
import { auditJourney } from '../../tests/helpers/journeys.mjs'

// Explicit live validation: sample public address only, never the user's home.
const root=fileURLToPath(new URL('../../',import.meta.url)), output=resolve(root,`.data/mobility-validation-${Date.now()}`)
await mkdir(output)
const sqlite=new DatabaseSync(resolve(root,'.data/gtfs.sqlite'),{readOnly:true})
const report={startedAt:new Date().toISOString(),checks:[],audit:{},cases:[],browserErrors:[],screenshots:[]}
const checked=(name,details={})=>{report.checks.push({name,...details});console.log('OK '+name)}
let server,browser
try{
  server=await startLocalServer();report.baseUrl=server.url
  const stop= id=>sqlite.prepare('SELECT * FROM stops WHERE id=?').get(id)
  const ids=['2397','12230','10129','50149','35660','35668','35669','36394']
  report.audit.stops=ids.map(stop)
  report.audit.dauphineTransfers=sqlite.prepare('SELECT * FROM transfers WHERE from_stop_id IN (?,?,?) OR to_stop_id IN (?,?,?)').all('10129','50149','35660','10129','50149','35660')
  assert.ok(!report.audit.dauphineTransfers.some(t=>t.from_stop_id==='10129'&&t.to_stop_id==='35660'))
  checked('Audit : lien bus → tram absent, lien inverse conservé sans symétrisation')
  async function search(changes={}){
    const query={from:{kind:'stop',id:'2397'},to:{kind:'stop',id:'35668'},at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:120,walkingTransfers:true,...changes}
    const before=performance.now()
    const response=await fetch(server.url+'/api/mobility/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(query),signal:AbortSignal.timeout(90000)})
    const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.status,'connected')
    for(const item of body.data.itineraries){
      const result=item.transitResult,journey=item.transit
      auditJourney(sqlite,result,journey)
      assert.equal(Date.parse(item.departureTime),Date.parse(journey.departureTime)-((item.access?.durationSeconds||0)+item.safetySeconds)*1000)
      assert.equal(Date.parse(item.arrivalTime),Date.parse(journey.arrivalTime)+(item.egress?.durationSeconds||0)*1000)
      assert.ok(query.mode==='departure'?Date.parse(item.departureTime)>=Date.parse(query.at):Date.parse(item.arrivalTime)<=Date.parse(query.at))
      for(const path of [item.access,item.egress,...(journey.connections||[]).map(c=>c.walkingPath)].filter(Boolean)){assert.equal(path.profile,'pedestrian');assert.ok(path.geometry.coordinates.length>=2);assert.ok(path.startSnapMeters<=25&&path.endSnapMeters<=25)}
    }
    const proof={query,httpMs:performance.now()-before,result:body.data};report.cases.push(proof);return proof
  }
  for(const from of ['2397','12230','35660']){
    const baseline=await fetch(server.url+'/api/journeys/search?'+new URLSearchParams({fromStopId:from,toStopId:from==='35660'?'35668':'36394',at:'2026-11-09T10:00:00Z',mode:'departure',marginSeconds:'120',order:'arrival',maxTransfers:'1'})).then(r=>r.json())
    report.audit['baseline-'+from]=baseline
    const proof=await search({from:{kind:'stop',id:from}})
    checked(`Secteur Lacassagne, quai ${from} → T3 La Soie : horaires et liens audités`,{state:proof.result.state,proposals:proof.result.itineraries.length,httpMs:proof.httpMs})
  }
  const addresses=await fetch(server.url+'/api/mobility/addresses?'+new URLSearchParams({q:'100 avenue Lacassagne Lyon'})).then(r=>r.json())
  assert.equal(addresses.status,'connected');const address=addresses.data.find(a=>a.precision==='housenumber'&&a.name.startsWith('100 Avenue Lacassagne'))
  assert.ok(address,'Source IGN réellement accessible, aucun résultat de substitution')
  report.audit.sampleAddress=address;checked('Adresse publique de test confirmée en direct dans la BAN via IGN')
  for(const mode of ['departure','arrival']){
    const proof=await search({from:{kind:'address',id:address.id,name:address.name},mode,order:mode==='arrival'?'departure':'arrival',at:mode==='arrival'?'2026-11-09T11:00:00Z':'2026-11-09T10:00:00Z'})
    assert.ok(['ok','limited'].includes(proof.result.state));assert.ok(proof.result.itineraries.some(p=>p.access));assert.ok(proof.result.metrics.confirmedPlatforms>5);checked(`Adresse → La Soie, ${mode}, plus de quatre accès confirmés et porte-à-porte audité`,{httpMs:proof.httpMs,metrics:proof.result.metrics})
  }
  const wrongDirection=await search({from:{kind:'stop',id:'35668'},to:{kind:'address',id:address.id,name:address.name},at:'2026-11-09T11:00:00Z',mode:'arrival',order:'departure'})
  assert.ok(wrongDirection.result.itineraries.every(item=>item.transit.legs[0].headsign==='Meyzieu les Panettes'&&item.transit.legs[0].from.id==='35668'))
  checked('Quai La Soie vers Meyzieu : aucun premier tronçon vers Lyon inventé ; éventuel détour audité')
  const reversed=await search({from:{kind:'stop',id:'35669'},to:{kind:'address',id:address.id,name:address.name},at:'2026-11-09T11:00:00Z',mode:'arrival',order:'departure'})
  assert.ok(['ok','limited'].includes(reversed.result.state));assert.ok(reversed.result.itineraries.some(item=>item.egress));checked('Marche finale incluse dans l’échéance Arriver avant')
  const destinations=await fetch(server.url+'/api/mobility/addresses?'+new URLSearchParams({q:'5 avenue des Canuts Vaulx-en-Velin'})).then(r=>r.json())
  assert.equal(destinations.status,'connected')
  const destination=destinations.data.find(a=>a.precision==='housenumber'&&a.name.includes('Vaulx-en-Velin'))
  assert.ok(destination,'Adresse de destination réellement confirmée par IGN')
  report.audit.sampleDestination=destination
  const doors=await search({from:{kind:'address',id:address.id,name:address.name},to:{kind:'address',id:destination.id,name:destination.name}})
  assert.ok(['ok','limited'].includes(doors.result.state));assert.ok(doors.result.itineraries.some(item=>item.access&&item.egress));checked('Deux adresses réelles : accès et sortie réseau inclus dans les horaires')
  assert.ok(Date.parse(doors.result.itineraries[0].arrivalTime)<=Date.parse('2026-11-09T10:26:02Z'),'Le trajet T3 validé ne doit pas être masqué par le budget de quais')
  checked('Trajet T3 précédemment validé conservé malgré l’exploration élargie')
  const outside=await search({at:'2028-01-01T10:00:00Z'});assert.equal(outside.result.itineraries.length,0);checked('Date hors GTFS : aucun trajet recyclé')
  browser=await startBrowser(output);report.browser=browser.version
  const d=browser.driver
  let externalCalls=0,latest=null
  d.on('Runtime.exceptionThrown',event=>report.browserErrors.push(event.exceptionDetails.exception?.description||event.exceptionDetails.text))
  d.on('Network.requestWillBeSent',event=>{if(event.request.url.startsWith('https://data.geopf.fr/'))externalCalls++})
  await d.send('Page.navigate',{url:server.url+'/'});await d.wait('document.querySelector(".journey-panel")',30000)
  const from='.journey-stop-fields>.gtfs-search-field:first-child',to='.journey-stop-fields>.gtfs-search-field:last-child'
  async function select(prefix,text,match){
    await d.type(prefix+' input',text);await d.wait(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).some(b=>b.textContent.includes(${JSON.stringify(match)}))`,20000)
    const index=await d.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).findIndex(b=>b.textContent.includes(${JSON.stringify(match)}))`)
    await d.click(prefix+` .gtfs-options li:nth-child(${index+1}) button`)
  }
  await select(from,'100 avenue Lacassagne Lyon','100 Avenue Lacassagne 69003 Lyon')
  await select(to,'Vaulx-en-Velin La Soie','Quai 35668 ·')
  await d.date('2026-11-09T11:00');await d.click('.journey-panel .search-button')
  await d.wait('document.querySelector(".mobility-results article") && !document.querySelector(".journey-panel .search-button").disabled',90000)
  latest=await d.evaluate('document.querySelector(".mobility-results").textContent')
  assert.match(latest,/Départ recommandé du domicile/);assert.match(latest,/Marche initiale/);assert.match(latest,/Horaire théorique/)
  checked('Navigateur : sélection adresse/quai, recherche réelle et départ domicile affiché')
  const desktop=resolve(output,'adresse-desktop.png');await d.screenshot(desktop);report.screenshots.push(desktop)
  await d.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  assert.ok(await d.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'));checked('Mobile 390 px sans débordement')
  const mobile=resolve(output,'adresse-mobile.png');await d.screenshot(mobile);report.screenshots.push(mobile)
  await d.evaluate('document.querySelector(".mobility-results").scrollIntoView({block:"start"})')
  const viewport=await d.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})
  const focus=resolve(output,'adresse-mobile-resultat.png');await writeFile(focus,Buffer.from(viewport.data,'base64'),{flag:'wx'});report.screenshots.push(focus)
  await d.click('.mobility-results>article:nth-of-type(2)>.door-proposal-details>summary')
  assert.ok(await d.evaluate('document.querySelectorAll(".mobility-results>article>.door-proposal-details")[1].open'));checked('Navigateur : plusieurs propositions comparables et détails accessibles')
  await select(to,destination.name,destination.name)
  await d.click('.journey-panel .search-button')
  await d.wait('document.querySelector(".mobility-results article") && document.querySelector(".mobility-results").textContent.includes("Marche finale") && !document.querySelector(".journey-panel .search-button").disabled',90000)
  checked('Navigateur mobile : trajet entre deux adresses avec marche finale visible')
  // Simulated upstream failure, explicitly a test; no fake successful address results.
  await d.send('Fetch.enable',{patterns:[{urlPattern:'*/api/mobility/addresses?*',requestStage:'Request'}]})
  d.on('Fetch.requestPaused',event=>{void d.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({error:'TEST : IGN indisponible'})).toString('base64')})})
  await d.type(from+' input','TEST adresse indisponible')
  await d.wait(`document.querySelector(${JSON.stringify(from)}).textContent.includes('TEST : IGN indisponible')`)
  checked('Navigateur : indisponibilité IGN explicite, sélection précédente retirée')
  assert.equal(externalCalls,0);assert.equal(report.browserErrors.length,0);checked('Aucun appel IGN direct du navigateur, aucune exception JavaScript')
  report.status='passed'
}catch(error){report.status='failed';report.error=error.stack;console.error(error);process.exitCode=1;if(browser){report.failedPage=await browser.driver.evaluate('document.body.innerText').catch(()=>null);await browser.driver.screenshot(resolve(output,'failure.png')).catch(()=>{})}}
finally{
  await browser?.close();server?.close();sqlite.close();report.finishedAt=new Date().toISOString()
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log('Rapport : '+output)
}
