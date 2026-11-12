import assert from 'node:assert/strict'
import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { startLocalServer } from './local-server.mjs'
import { startBrowser } from './browser-driver.mjs'

const label=process.argv[2]||'after',repeats=Number(process.env.EXPERIENCE_REPEATS||3)
assert.ok(['before','after'].includes(label));assert.ok(repeats>=2&&repeats<=5)
const output=resolve(`.data/experience-${label}-${Date.now()}`);await mkdir(output)
const report={label,repeats,samples:[],notes:['Cold = nouveau processus backend et profil navigateur, caches disque non vidés.','Mesures perçues : clic → premier état de chargement, première étape serveur, puis résultat rendu.','Adresse publique de test, aucun horaire simulé.']}
for(let iteration=0;iteration<repeats;iteration++){
  let server,browser
  try{
    server=await startLocalServer();browser=await startBrowser(resolve(output,'run-'+iteration));const d=browser.driver
    const requests=new Map(),responses=[],tasks=[]
    d.on('Network.requestWillBeSent',e=>{if(e.request.url.includes('/api/mobility/search'))requests.set(e.requestId,{start:e.timestamp})})
    d.on('Network.loadingFinished',e=>{const r=requests.get(e.requestId);if(!r)return;tasks.push(d.send('Network.getResponseBody',{requestId:e.requestId}).then(value=>{const raw=value.base64Encoded?Buffer.from(value.body,'base64').toString():value.body;const events=raw.trim().split('\n').map(line=>JSON.parse(line));const result=events.findLast(event=>event.type==='result')?.value || events.find(event=>event.status==='connected');responses.push({httpMs:(e.timestamp-r.start)*1000,metrics:result?.data.metrics,first:result?.data.itineraries[0]?.transit.legs.map(l=>l.lineName),serverStages:events.filter(e=>e.type==='stage')})}))})
    await d.send('Page.navigate',{url:server.url+'/'});await d.wait('document.querySelector(".journey-panel")',30000)
    const from='.journey-stop-fields>.gtfs-search-field:first-child',to='.journey-stop-fields>.gtfs-search-field:last-child'
    async function select(prefix,text,match){
      await d.type(prefix+' input',text)
      await d.wait(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).some(b=>b.textContent.includes(${JSON.stringify(match)}))`,20000)
      const index=await d.evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(prefix+' .gtfs-options button')})).findIndex(b=>b.textContent.includes(${JSON.stringify(match)}))`)
      await d.click(prefix+` .gtfs-options li:nth-child(${index+1}) button`)
    }
    await select(from,'100 avenue Lacassagne Lyon','100 Avenue Lacassagne 69003 Lyon');await select(to,'Vaulx-en-Velin La Soie','Quai 35668 ·');await d.date('2026-11-09T11:00')
    for(const cache of ['cold','warm']){
      await d.evaluate(`(()=>{
        window.__experience={started:performance.now(),feedbackMs:null,stageMs:null,resultMs:null,stages:[]};
        const state=window.__experience;
        state.observer=new MutationObserver(()=>{
          const busy=document.querySelector('.search-button').disabled;
          if(busy&&state.feedbackMs===null)state.feedbackMs=performance.now()-state.started;
          const progress=document.querySelector('[data-server-stage]');
          if(progress){if(state.stageMs===null)state.stageMs=performance.now()-state.started;const stage=progress.dataset.serverStage;if(!state.stages.includes(stage))state.stages.push(stage)}
          if(state.feedbackMs!==null&&!busy&&document.querySelector('.mobility-results article')){state.resultMs=performance.now()-state.started;state.observer.disconnect()}
        });state.observer.observe(document.querySelector('.journey-panel'),{subtree:true,childList:true,attributes:true});
      })()`)
      await d.click('.journey-panel .search-button')
      await d.wait('window.__experience.resultMs!==null',90000)
      await Promise.all(tasks)
      const transport=responses.at(-1)
      const sample=await d.evaluate('({...window.__experience,observer:undefined})')
      assert.ok(transport?.metrics && transport?.first?.length, 'Le r?sultat rendu doit ?tre accompagn? de la r?ponse r?elle r?ussie')
      report.samples.push({iteration,cache,...sample,transport});console.log(iteration+1,cache,JSON.stringify(sample))
    }
  }catch(error){report.error=error.stack;process.exitCode=1;break}
  finally{await browser?.close();server?.close()}
}
report.status=report.error?'failed':'passed'
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)
