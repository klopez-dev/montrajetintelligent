import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { startBrowser } from './browser-driver.mjs'

const base=process.env.TEST_BASE_URL
if(!base || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('TEST_BASE_URL local requis')
const output=resolve(`.data/realtime-local-browser-${Date.now()}`)
await mkdir(output)
const report={base,startedAt:new Date().toISOString(),checks:[],browser:null,api:null,visible:[],supplierBrowserCalls:0,status:'running'}
let browser
try{
 const status=await (await fetch(`${base}/api/realtime/status`)).json()
 assert.equal(status.reason,'local_validation_once')
 assert.equal(status.itineraryEnrichment,'disabled')
 browser=await startBrowser(output);report.browser=browser.version
 const d=browser.driver
 d.on('Network.requestWillBeSent',event=>{if(event.request.url.startsWith('https://data.grandlyon.com/'))report.supplierBrowserCalls++})
 await d.send('Page.navigate',{url:base})
 await d.wait('document.querySelector("nav button:nth-child(3)")',30000)
 await d.click('nav button:nth-child(3)')
 await d.wait('document.querySelector(".feed-metadata")',30000)
 await d.type('.gtfs-search-field:nth-child(1) input','C13')
 await d.wait('document.querySelector(".gtfs-search-field:nth-child(1) .gtfs-options button")')
 const lineIndex=await d.evaluate(`[...document.querySelectorAll('.gtfs-search-field:nth-child(1) .gtfs-options button')].findIndex(b=>b.textContent.includes('Identifiant C13'))`)
 assert.ok(lineIndex>=0)
 await d.click(`.gtfs-search-field:nth-child(1) .gtfs-options li:nth-child(${lineIndex+1}) button`)
 await d.type('.gtfs-search-field:nth-child(2) input','50141')
 await d.wait('document.querySelector(".gtfs-search-field:nth-child(2) .gtfs-options button")')
 const stopIndex=await d.evaluate(`[...document.querySelectorAll('.gtfs-search-field:nth-child(2) .gtfs-options button')].findIndex(b=>b.textContent.includes('Identifiant 50141'))`)
 assert.ok(stopIndex>=0)
 await d.click(`.gtfs-search-field:nth-child(2) .gtfs-options li:nth-child(${stopIndex+1}) button`)
 await d.click('form .primary')
 await d.wait('document.querySelector(".passages-results")',30000)
 await d.wait('document.querySelector(".realtime-panel [role=status]") && !document.querySelector(".realtime-panel").getAttribute("aria-busy").includes("true")',30000)
 report.api=await d.evaluate(`(async()=>{const r=await fetch('/api/realtime/passages?lineId=C13&stopId=50141');return await r.json()})()`)
 report.visible=await d.evaluate(`([...document.querySelectorAll('.realtime-list li')].map(li=>({time:li.querySelector('strong')?.textContent,label:li.querySelector('.estimated-label')?.textContent,direction:li.querySelector('div>span')?.textContent})))`)
 assert.equal(report.supplierBrowserCalls,0)
 assert.ok((await d.evaluate(`document.querySelector('.realtime-panel')?.textContent.includes('Validation locale ponctuelle')`)))
 assert.ok((await d.evaluate(`document.querySelector('.feed-metadata')?.textContent.includes('Horaire théorique')`)))
 assert.ok(report.visible.every(item=>item.label.includes('Data Grand Lyon') && (item.label.includes('estimé')||item.label.includes('théorique'))))
 assert.ok(report.visible.length<=5)
 await d.screenshot(resolve(output,'passages-local.png'))
 await d.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 assert.equal(await d.evaluate('document.documentElement.scrollWidth>innerWidth'),false)
 await d.screenshot(resolve(output,'passages-local-mobile.png'))
 report.checks.push('Frontend Horaires et GTFS visibles','Mode local ponctuel visible','Aucun appel direct du navigateur au fournisseur','Types E/T affiches distinctement','Cinq passages maximum par defaut')
 report.checks.push('Aucun debordement horizontal a 390 px')
 report.status='passed'
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1}
finally{await browser?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({status:report.status,visible:report.visible.length,apiState:report.api?.state,apiReason:report.api?.reason,report:resolve(output,'report.json')}))}
