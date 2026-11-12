import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { startLocalServer } from './local-server.mjs'
import { startBrowser } from './browser-driver.mjs'
import { auditJourney } from '../../tests/helpers/journeys.mjs'

const output=resolve(`.data/network-validation-${Date.now()}`);await mkdir(output)
const sqlite=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true})
const report={checks:[],cases:[],errors:[],screenshots:[]},check=name=>{report.checks.push(name);console.log('OK '+name)}
let server,browser
try{
  server=await startLocalServer()
  report.baseUrl=server.url
  async function search(changes={}){
    const q={fromStopId:'1138',toStopId:'36394',at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:'120',maxTransfers:'2',...changes}
    const t=performance.now(),response=await fetch(server.url+'/api/journeys/search?'+new URLSearchParams(q)),body=await response.json()
    assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.status,'connected')
    for(const journey of body.data.itineraries)auditJourney(sqlite,body.data,journey)
    report.cases.push({query:q,httpMs:performance.now()-t,result:body.data});return body.data
  }
  const double=await search();assert.ok(double.itineraries.length);assert.ok(double.itineraries.every(j=>j.transfers===2&&j.connections.length===2));check('Harmonie Campus Pro → Soie : deux correspondances réelles auditées dans SQLite')
  const one=await search({maxTransfers:'1'});assert.equal(one.itineraries.length,0);check('Même trajet absent du périmètre à une correspondance')
  const reverse=await search({mode:'arrival',order:'departure',at:'2026-11-09T11:00:00Z'});assert.ok(reverse.itineraries.some(j=>j.transfers===2));check('Arriver avant avec deux correspondances et marges vérifiées')
  for(const [fromStopId,toStopId]of[['2397','36394'],['12230','36394'],['35660','35668']]){
    const r=await search({fromStopId,toStopId});assert.ok(r.itineraries.length);check(`Régression GTFS ${fromStopId} → ${toStopId}, moteur deux correspondances`)
  }
  const out=await search({at:'2028-01-01T10:00:00Z'});assert.equal(out.state,'outside_validity');assert.equal(out.itineraries.length,0);check('Date non couverte : aucun service recyclé')
  browser=await startBrowser(output);const d=browser.driver
  d.on('Runtime.exceptionThrown',e=>report.errors.push(e.exceptionDetails.text))
  d.on('Network.loadingFailed',e=>{ if(e.canceled) (report.cancellations??=[]).push(e.errorText); else report.errors.push(e.errorText) })
  report.navigation=await d.send('Page.navigate',{url:server.url+'/'})
  await d.wait('document.querySelector(".journey-panel")',30000)
  const from='.journey-stop-fields>.gtfs-search-field:first-child',to='.journey-stop-fields>.gtfs-search-field:last-child'
  async function select(prefix,text,id){
    await d.type(prefix+' input',text);await d.wait(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).some(b=>b.textContent.includes('Quai '+${JSON.stringify(id)}+' ·'))`)
    const index=await d.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).findIndex(b=>b.textContent.includes('Quai '+${JSON.stringify(id)}+' ·'))`)
    await d.click(prefix+` .gtfs-options li:nth-child(${index+1}) button`)
  }
  await select(from,'Harmonie Campus Pro','1138');await select(to,'Vaulx-en-Velin La Soie','36394');await d.date('2026-11-09T11:00')
  assert.equal(await d.evaluate(`document.querySelector('select[aria-label="Correspondances maximum"]').value`),'2')
  await d.click('.journey-panel .search-button');await d.wait('document.querySelector(".journey-proposals>li") && !document.querySelector(".search-button").disabled',30000)
  assert.equal(await d.evaluate('document.querySelector(".journey-proposals>li").querySelectorAll(".journey-connection").length'),2)
  assert.match(await d.evaluate('document.querySelector(".journey-summary").textContent'),/2 correspondances/)
  const domTimes=await d.evaluate('Array.from(document.querySelector(".journey-proposals>li").querySelectorAll("time")).map(t=>t.dateTime)')
  assert.deepEqual(domTimes,[double.itineraries[0].departureTime,double.itineraries[0].arrivalTime]);check('Navigateur : trois véhicules, deux transferts et heures réellement rendus')
  assert.match(await d.evaluate('document.querySelector(".journey-results").textContent'),/Exploration partielle/);check('Budget atteint affiché explicitement, aucun faux classement complet')
  for(const width of [390,320]){
    await d.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true})
    assert.ok(await d.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1'))
    const file=resolve(output,`deux-correspondances-${width}.png`);await d.screenshot(file);report.screenshots.push(file);check(`Mobile ${width} px sans débordement`)
  }
  assert.deepEqual(report.errors,[]);assert.match(await d.evaluate('document.querySelector("footer").textContent'),/V0.1/);check('Aucune exception JavaScript et version V0.1 conservée')
  report.status='passed'
}catch(error){report.status='failed';report.error=error.stack;console.error(error);process.exitCode=1;if(browser){report.failureDom=await browser.driver.evaluate('({url:location.href,ready:document.readyState,html:document.documentElement.outerHTML})').catch(()=>null);await browser.driver.screenshot(resolve(output,'failure.png')).catch(()=>{})}}
finally{await browser?.close();server?.close();sqlite.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
