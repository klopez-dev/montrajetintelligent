import {HybridClient} from './client.ts'
import {engineSelector} from './engine-selector.ts'
import type {MobilityScenario} from './scenarios.ts'
import type {MobilityQuery,MobilityResult} from '../../src/types/mobility.ts'
import {searchStageLabels} from '../../src/types/searchProgress.ts'
const node=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T
const client=new HybridClient(),run=node<HTMLButtonElement>('run'),load=node<HTMLButtonElement>('load'),output=node<HTMLPreElement>('output'),issue=node<HTMLParagraphElement>('issue'),stage=node<HTMLParagraphElement>('stage')
let cases:MobilityScenario[]=[],controller:AbortController|undefined,generation=0
let fullDiagnostics:unknown
const details=document.createElement('button');details.textContent='Afficher le diagnostic complet';details.hidden=true;output.before(details);details.onclick=()=>{output.textContent=JSON.stringify(fullDiagnostics,null,2)}
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='metrics').map(([k,v])=>[k,canonical(v)]));return value}
load.onclick=async()=>{load.disabled=true;try{const r=await fetch('/prototype/mobility/scenarios');const body=await r.json();if(!r.ok)throw new Error(body.error||'Relais IGN indisponible');cases=body.cases;node('provider').textContent=body.mode;const select=node<HTMLSelectElement>('scenario');select.replaceChildren(...cases.map(c=>new Option(c.label,c.id)));select.disabled=false;run.disabled=false;issue.textContent=''}catch(e){issue.textContent=e instanceof Error?e.message:'Chargement indisponible'}finally{load.disabled=false}}
const cancel=()=>{generation++;controller?.abort();client.cancel();run.disabled=!cases.length;stage.textContent='Recherche annulée';output.dataset.status='cancelled'}
node<HTMLButtonElement>('cancel').onclick=cancel
run.onclick=async()=>{
 controller?.abort();controller=new AbortController();const signal=controller.signal,id=++generation
 const selected=cases.find(c=>c.id===node<HTMLSelectElement>('scenario').value)!,mode=node<HTMLSelectElement>('mode').value as MobilityQuery['mode'],query={...selected.query,at:node<HTMLInputElement>('at').value,mode,order:mode==='arrival'?'departure' as const:'arrival' as const},engine=node<HTMLSelectElement>('engine').value
 run.disabled=true;issue.textContent='';stage.textContent='Démarrage de la recherche';output.dataset.status='loading'
 try{
  const selector=engineSelector(async q=>{const r=await fetch('/prototype/mobility/reference',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(q),signal});const b=await r.json();if(!r.ok)throw new Error(b.error||'SQLite indisponible');return{result:b}},q=>client.search(q,signal,event=>{if(id===generation)stage.textContent=searchStageLabels[event.stage]}),true)
  const started=performance.now(),result=await selector.search(query,engine==='sqlite'?'sqlite':'hybrid')
  const baseline=engine==='compare'?await selector.search(query,'sqlite'):undefined
  if(id!==generation)return
  const equal=baseline?JSON.stringify(canonical(result.result))===JSON.stringify(canonical(baseline.result)):null
  fullDiagnostics={engine,scenario:selected.id,equal,totalPerceivedMs:performance.now()-started,...result};details.hidden=false
  // Preserve all travel legs and walking paths. Avoid rendering each proposal's
  // complete duplicate reference result automatically; it remains available above.
  const full:MobilityResult=result.result,displayed={...full,itineraries:full.itineraries.map(({transitResult:_reference,...journey})=>journey)}
  output.textContent=JSON.stringify({...fullDiagnostics as object,result:displayed},null,2);output.dataset.status=equal===false?'divergent':'passed';stage.textContent='Recherche terminée'
 }catch(e){if(id!==generation||signal.aborted)return;issue.textContent=e instanceof Error?e.message:'Recherche indisponible';output.dataset.status='failed';stage.textContent='Échec explicite ; le résultat précédent reste consultable'}finally{if(id===generation)run.disabled=false}
}
// Date edits cancel only an existing calculation; no automatic expensive restart.
node<HTMLInputElement>('at').onchange=()=>{if(run.disabled&&cases.length)cancel()}
