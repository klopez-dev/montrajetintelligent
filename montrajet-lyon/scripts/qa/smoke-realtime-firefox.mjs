import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { startFirefox } from './firefox-driver.mjs'

const base=process.env.TEST_BASE_URL
if(!base)throw Error('TEST_BASE_URL requis pour le contrôle Firefox local.')
const output=resolve(`.data/realtime-firefox-${Date.now()}`);await mkdir(output)
const report={base,checks:[]};let browser
try{
 browser=await startFirefox(output);report.browser=browser.version
 const d=browser.driver;await d.navigate(base);await d.wait('document.querySelector("nav button")',30000)
 await d.evaluate(`(()=>{[...document.querySelectorAll('nav button')].find(b=>b.textContent.trim()==='Horaires').click();return true})()`)
 await d.wait('document.querySelector(".feed-metadata")',30000)
 const status=await d.evaluate(`(async()=>{const r=await fetch('/api/realtime/status');return{http:r.status,data:await r.json()}})()`)
 assert.equal(status.http,200);assert.equal(status.data.state,'disabled');assert.ok(['authentication_required','policy_unconfirmed','mapping_unconfirmed'].includes(status.data.reason))
 report.checks.push(`Frontend Horaires et GTFS visibles ; état temps réel ${status.data.reason} explicite, sans secret`)
 for(const width of [320,390,768,1440]){await d.viewport(width);assert.equal(await d.evaluate('document.documentElement.scrollWidth>innerWidth'),false);if(width===390)await d.screenshot(resolve(output,'horaires-390.png'))}
 report.checks.push('Aucun débordement à 320/390/768/1440 px');report.status='passed'
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1}finally{await browser?.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
