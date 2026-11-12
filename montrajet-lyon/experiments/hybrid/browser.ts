import type {RoutingQuery} from '../../src/types/journey.ts'
let worker:Worker|null=null,generation=0
let referenceAbort:AbortController|undefined
let fallback:unknown
const output=document.querySelector<HTMLPreElement>('#output')!,button=document.querySelector<HTMLButtonElement>('#run')!
const standalone=new URL(location.href).searchParams.has('standalone')
if(standalone)button.textContent='Calculer dans le navigateur'
const fallbackButton=document.createElement('button');fallbackButton.textContent='Afficher la référence SQLite disponible';fallbackButton.hidden=true;button.parentElement!.insertBefore(fallbackButton,output)
fallbackButton.onclick=()=>{output.textContent=JSON.stringify({source:'Moteur SQLite existant — repli explicite, pas un résultat du worker',result:fallback},null,2);output.dataset.status='fallback'}
const cases:Record<string,[string,string,string,'departure'|'arrival']>={direct:['35660','35668','2026-11-09T10:00:00Z','departure'],one:['2397','36394','2026-11-09T10:00:00Z','departure'],two:['1138','36394','2026-11-09T10:00:00Z','departure'],arrival:['1138','36394','2026-11-09T11:00:00Z','arrival'],midnight:['35660','35668','2026-11-09T23:05:00Z','departure']}
button.onclick=()=>{
  const id=++generation,values=cases[document.querySelector<HTMLSelectElement>('#case')!.value]
  const query:RoutingQuery={fromStopId:values[0],toStopId:values[1],at:values[2],mode:values[3],order:values[3]==='arrival'?'departure':'arrival',marginSeconds:120,maxTransfers:2}
  button.disabled=true;output.textContent='Chargement des données vérifiées puis calcul dans le worker navigateur…';output.dataset.status='loading'
  fallbackButton.hidden=true;fallback=undefined;referenceAbort?.abort();referenceAbort=new AbortController()
  const reference=standalone?Promise.resolve(undefined):fetch('/prototype/reference',{method:'POST',signal:referenceAbort.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(query)}).then(async r=>{const body=await r.json();if(!r.ok||body.status!=='connected')throw new Error('Référence SQLite indisponible');return body.data})
  const fail=async(message:string)=>{if(id!==generation)return;output.textContent=message+' Aucun itinéraire navigateur produit.';output.dataset.status='failed';button.disabled=false;try{const value=await reference;if(id!==generation||!value)return;fallback=value;fallbackButton.hidden=false}catch{/* Keep original provider/worker error. */}}
  try{worker??=new Worker(new URL('./browser-worker.ts',import.meta.url),{type:'module'})}catch(e){void fail(e instanceof Error?e.message:'Web Worker indisponible');return}
  worker.onmessage=async e=>{
    if(id!==generation||e.data.id!==id)return
    try{
      if(e.data.error)throw new Error(e.data.error)
      const baseline=await reference;if(id!==generation)return
      const canonical=(r:typeof baseline)=>JSON.stringify({state:r.state,itineraries:r.itineraries,scope:r.scope,warnings:r.warnings})
      const equal=baseline?canonical(baseline)===canonical(e.data.result):null
      output.textContent=JSON.stringify({equal,workerWallMs:e.data.elapsedMs,compressedBytes:e.data.compressedBytes,diagnostics:{metrics:e.data.metrics,residentDays:e.data.residentDays,version:e.data.version,requests:e.data.requests,calculationMs:e.data.calculationMs,serializationMs:e.data.serializationMs},result:e.data.result},null,2)
      output.dataset.status=equal===null?'computed':equal?'passed':'divergent'
    }catch(e){void fail(e instanceof Error?e.message:'Échec')}
    finally{if(id===generation)button.disabled=false}
  }
  void reference.catch(()=>{}) // Reported alongside the worker result, never an unhandled rejection.
  worker.onerror=()=>{if(id!==generation)return;worker?.terminate();worker=null;void fail('Le worker expérimental a échoué (ressources ou exécution).')}
  try{worker.postMessage({id,query})}catch(e){worker.terminate();worker=null;void fail(e instanceof Error?e.message:'Envoi au worker impossible')}
}
document.querySelector<HTMLButtonElement>('#cancel')!.onclick=()=>{generation++;referenceAbort?.abort();worker?.terminate();worker=null;fallbackButton.hidden=true;button.disabled=false;output.dataset.status='cancelled';output.textContent='Calcul expérimental annulé. Aucune réponse ancienne affichée.'}
