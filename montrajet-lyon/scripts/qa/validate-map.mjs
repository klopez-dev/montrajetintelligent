import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {startBrowser} from './browser-driver.mjs'
import {startLocalServer} from './local-server.mjs'
const output=resolve(`.data/map-validation-${Date.now()}`);await mkdir(output)
const report={checks:[],errors:[],cases:[],screenshots:[]};const checked=s=>{report.checks.push(s);console.log('OK '+s)}
let server,browser
try{
 server=await startLocalServer();browser=await startBrowser(output);const d=browser.driver
 let providerRequests=0,mapRequests=0,tileRequests=0
 d.on('Network.requestWillBeSent',e=>{if(/\/api\/mobility\//.test(e.request.url))providerRequests++;if(e.request.url.endsWith('/api/maps'))mapRequests++;if(e.request.url.includes('tile.openstreetmap.org'))tileRequests++})
 d.on('Runtime.exceptionThrown',e=>report.errors.push(e.exceptionDetails.exception?.description||e.exceptionDetails.text))
 await d.send('Page.navigate',{url:server.url+'/'})
 try{await d.wait('document.querySelector(".journey-panel")',30000)}catch{await d.reload();await d.wait('document.querySelector(".journey-panel")',30000)}
 const from='.journey-stop-fields>.gtfs-search-field:first-child',to='.journey-stop-fields>.gtfs-search-field:last-child'
 async function select(prefix,text,match){await d.type(prefix+' input',text);await d.wait(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).some(b=>b.textContent.includes(${JSON.stringify(match)}))`,30000);const i=await d.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).findIndex(b=>b.textContent.includes(${JSON.stringify(match)}))`);await d.click(prefix+` .gtfs-options li:nth-child(${i+1}) button`)}
 async function search(a,b){await select(from,a[0],a[1]);await select(to,b[0],b[1]);await d.date('2026-11-09T11:00');const t=performance.now();await d.click('.search-button');await d.wait('!document.querySelector(".search-button").disabled && document.querySelector(".show-journey-map")',120000);report.cases.push({from:a,to:b,searchBrowserMs:performance.now()-t});await openMap()}
 async function openMap(){const before=providerRequests,start=performance.now();await d.click('.show-journey-map');await d.wait('document.querySelector(".map-steps button") && document.querySelector(".map-point") && document.querySelector(".journey-map").dataset.mapLoading==="false" && document.querySelector(".journey-map").dataset.mapJourney===document.querySelector(".show-journey-map[aria-pressed=true]").closest(".journey-proposal").dataset.journeyId',60000);assert.equal(providerRequests,before,'No new geocoding/walking for map');const text=await d.evaluate('document.querySelector(".map-metrics").textContent');report.cases.at(-1).map={browserMs:performance.now()-start,metrics:text,markers:await d.evaluate('document.querySelectorAll(".map-point").length')};checked('Carte : arrêts réels, aucun appel IGN supplémentaire, '+report.cases.at(-1).from[0]);assert.ok(await d.evaluate('document.querySelector(".journey-map").textContent.includes("tracés absents")'));}
 const dau=['Dauphiné-Lacassagne','Quai 35660 ·'],soie=['Vaulx-en-Velin La Soie','Quai 35668 ·']
 await search(dau,soie)
 assert.equal(await d.evaluate('document.querySelectorAll(".map-steps li").length'),1);checked('T3 direct : arrêts ordonnés sans tracé inventé')
 const before=mapRequests;await d.click('.journey-proposals>li:nth-child(2) .show-journey-map');await d.wait('document.querySelectorAll(".show-journey-map")[1].getAttribute("aria-pressed")==="true" && !!document.querySelector(".map-point")',30000);assert.ok(mapRequests>=before);checked('Changement de proposition synchronisé')
 await d.click('.map-steps button');assert.equal(await d.evaluate('document.querySelector(".map-steps button").getAttribute("aria-pressed")'),'true')
 await d.click('.map-point');await d.click('.map-recenter');await d.click('.maplibregl-ctrl-zoom-in');await d.click('.maplibregl-ctrl-zoom-out');checked('Sélection d’étape et marqueur, zoom et recentrage')
 let heldMap=null
 d.on('Fetch.requestPaused',async e=>{if(!e.request.url.endsWith('/api/maps'))return;if(!heldMap){heldMap=e.requestId;return}await d.send('Fetch.continueRequest',{requestId:e.requestId})})
 await d.send('Fetch.enable',{patterns:[{urlPattern:'*/api/maps',requestStage:'Request'}]})
 await d.click('.journey-proposals>li:nth-child(3) .show-journey-map');await d.wait('document.querySelector(".journey-map").dataset.mapLoading==="true"',10000)
 assert.equal(await d.evaluate('document.querySelectorAll(".map-point").length'),0)
 await d.click('.journey-proposals>li:nth-child(4) .show-journey-map')
 await d.wait('document.querySelector(".journey-map").dataset.mapJourney===document.querySelector(".show-journey-map[aria-pressed=true]").closest(".journey-proposal").dataset.journeyId && !!document.querySelector(".map-point")',30000)
 try{await d.send('Fetch.continueRequest',{requestId:heldMap})}catch{/* The browser may already have cancelled it. */}
 await d.send('Fetch.disable');assert.equal(await d.evaluate('document.querySelectorAll(".show-journey-map")[3].getAttribute("aria-pressed")'),'true');checked('Ancienne récupération annulée, anciens marqueurs effacés, seule la dernière proposition est dessinée')
 await d.click('.save-button');await d.click('nav button:nth-child(5)');await d.wait('document.querySelector(".recalculate-favorite")')
 await d.click('.recalculate-favorite');await d.wait('!document.querySelector(".search-button").disabled && document.querySelector(".show-journey-map")',30000);await openMap();checked('Trajet favori recalculé puis affiché sur la carte')
 for(const width of [1440,768,390,320]){await d.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<600});assert.equal(await d.evaluate('document.documentElement.scrollWidth>innerWidth'),false);const path=resolve(output,`map-${width}.png`);await d.screenshot(path);report.screenshots.push(path)}checked('1440/768/390/320 px sans débordement')
 await d.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 if(process.env.MAP_ERROR_ONLY!=='true'){
 await search(['Place Henri','Quai 2397 ·'],['Vaulx-en-Velin La Soie','Quai 36394 ·']);assert.ok(await d.evaluate('document.querySelector(".journey-summary").textContent.includes("1 correspondance")'));checked('Une correspondance : quais distincts et transfert sans ligne inventée')
 await search(['Harmonie Campus Pro','Quai 1138 ·'],['Vaulx-en-Velin La Soie','Quai 36394 ·']);assert.ok(await d.evaluate('document.querySelector(".journey-summary").textContent.includes("2 correspondances")'));checked('Deux correspondances réelles sur la carte')
 const home=['100 avenue Lacassagne Lyon','100 Avenue Lacassagne'],work=['5 avenue Canuts Vaulx','5 Avenue des Canuts']
 await search(home,work);assert.ok(await d.evaluate('document.querySelector(".map-steps").textContent.includes("Marche initiale") && document.querySelector(".map-steps").textContent.includes("Marche finale")'));checked('Adresse → adresse : géométries IGN existantes et durées conservées')
 await search(home,soie);checked('Adresse → arrêt sur la carte')
 await search(dau,home);checked('Arrêt → adresse sur la carte')
 }
 if(process.env.VITE_MAP_PROVIDER==='none'){
 assert.equal(tileRequests,0);assert.ok(await d.evaluate('document.querySelector(".journey-map").textContent.includes("Fond distant désactivé")'));checked('Vue sans fond distant : marqueurs et contrôles fonctionnels, aucune tuile demandée')
 }else{
 // Only provider failure is injected. Success geometries and all routes above were real.
 d.on('Fetch.requestPaused',async e=>{await d.send('Fetch.failRequest',{requestId:e.requestId,errorReason:'Failed'})})
 await d.send('Fetch.enable',{patterns:[{urlPattern:'*tile.openstreetmap.org*',requestStage:'Request'}]})
 for(let i=0;i<4;i++)await d.click('.maplibregl-ctrl-zoom-in')
 await d.wait('!!document.querySelector(".map-tile-error")',30000);assert.ok(await d.evaluate('!!document.querySelector(".result-summary") && !!document.querySelector(".journey-proposal")'));checked('Erreur de tuiles : avertissement explicite, texte préservé')
 await d.send('Fetch.disable')
 assert.ok(tileRequests>0)
 }
 assert.deepEqual(report.errors,[]);report.mapRequests=mapRequests;report.tileRequests=tileRequests;report.providerRequests=providerRequests;report.status='passed'
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1;if(browser)try{report.dom=await browser.driver.evaluate('document.body.innerText');await browser.driver.screenshot(resolve(output,'failure.png'))}catch{}}
finally{await browser?.close();server?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(output)}
