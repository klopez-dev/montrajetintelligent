/** This fetch adapter exists only in the separate preproduction entry bundle. */
import './results/styles.css'
const nativeFetch=globalThis.fetch.bind(globalThis)
let worker:Worker|undefined,sequence=0
const pending=new Map<number,{resolve:(v:unknown)=>void;reject:(e:Error)=>void;progress?:(v:unknown)=>void;cleanup:()=>void}>()
const diagnostics:{engine:string;events:unknown[]}={engine:'GTFS dans Web Worker — préproduction uniquement',events:[]}
Object.assign(globalThis,{__MTL_PREPRODUCTION__:{snapshot:()=>structuredClone(diagnostics),reset:()=>terminate()}})
function terminate(){worker?.terminate();worker=undefined;for(const p of pending.values()){p.cleanup();p.reject(new DOMException('Recherche annulée','AbortError'))}pending.clear()}
export function callWorker(op:string,args:unknown,signal?:AbortSignal,progress?:(v:unknown)=>void):Promise<unknown>{
 signal?.throwIfAborted();const id=++sequence
 return new Promise((resolve,reject)=>{
  const abort=()=>{if(op==='search')terminate();else{worker?.postMessage({op:'cancel',args:{id}});pending.delete(id);cleanup();reject(new DOMException('Recherche annulée','AbortError'))}},cleanup=()=>signal?.removeEventListener('abort',abort)
  signal?.addEventListener('abort',abort,{once:true});pending.set(id,{resolve,reject,progress,cleanup})
  try{if(!worker){worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});worker.onmessage=e=>{if(e.data.diagnostic){diagnostics.events.push(e.data.diagnostic);if(diagnostics.events.length>256)diagnostics.events.shift();return}const p=pending.get(e.data.id);if(!p)return;if(e.data.progress){p.progress?.(e.data.progress);return}p.cleanup();pending.delete(e.data.id);if(e.data.error)p.reject(new Error(e.data.error));else p.resolve(e.data.result)};worker.onerror=()=>{for(const p of pending.values()){p.cleanup();p.reject(new Error('Worker GTFS indisponible ; aucun résultat de remplacement'))}pending.clear();worker?.terminate();worker=undefined}}
   worker.postMessage({id,op,args})
  }catch(e){cleanup();pending.delete(id);reject(e)}
 })
}
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
async function route(request:Request):Promise<Response>{
 const url=new URL(request.url),p=Object.fromEntries(url.searchParams),path=url.pathname
 if(request.method!=='GET'&&request.method!=='POST')return json({error:'Méthode non autorisée'},405)
 if(JSON.stringify(p).length>4096)return json({error:'Entrée trop volumineuse'},413)
 if(path.startsWith('/api/traffic'))return json({status:'connected',data:{state:'unavailable',partial:true,incidents:[],coverage:[],checkedAt:new Date().toISOString(),sourceUrl:'https://www.tcl.fr/se-deplacer/infos-trafic',error:'Préproduction statique : annonces TCL non actualisées. Consultez la source officielle ; aucun trafic normal déduit.',metrics:{upstreamRequests:0,cacheHit:false,durationMs:0},notices:[]}})
 if(path.startsWith('/api/realtime'))return json({state:'unavailable',reason:'disabled',checkedAt:new Date().toISOString(),fetchedAt:null,sourceUpdatedAt:null,estimates:[],mapping:null,message:'Temps réel désactivé : seuls les horaires théoriques sont disponibles.'})
 let op='',args:unknown=p
 if(path==='/api/maps'){const text=await request.text();if(text.length>12000)return json({error:'Carte : entrée trop grande'},413);op='maps';args=JSON.parse(text)}
 else if(path.startsWith('/api/gtfs/'))op=path.split('/').at(-1)!
 else if(path==='/api/journeys/stops')op='journeyStops'
 else if(path==='/api/mobility/addresses')op='addresses'
 else if(path==='/api/journeys/search'){op='search';args={...p,marginSeconds:Number(p.marginSeconds),maxTransfers:Number(p.maxTransfers||2)}}
 else if(path==='/api/mobility/search'){const text=await request.text();if(text.length>4096)return json({error:'Entrée trop grande'},413);op='search';args=JSON.parse(text)}
 else return json({error:'API non disponible dans cette préproduction'},503)
 if(op==='search'){
  const encoder=new TextEncoder(),stream=new ReadableStream({start(controller){const emit=(v:unknown)=>{try{controller.enqueue(encoder.encode(JSON.stringify(v)+'\n'))}catch{/* Reader cancelled. */}};void callWorker(op,args,request.signal,event=>emit({type:'stage',...event as object})).then(data=>emit({type:'result',value:{status:'connected',data}})).catch(e=>emit({type:'error',message:e.message})).finally(()=>{try{controller.close()}catch{}})}})
  return new Response(stream,{headers:{'Content-Type':'application/x-ndjson'}})
 }
 return json({status:'connected',data:await callWorker(op,args,request.signal)})
}
globalThis.fetch=async(input,init)=>{
 const request=new Request(input instanceof Request?input:new URL(String(input),location.href),init),url=new URL(request.url)
 if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return nativeFetch(request)
 try{const r=await route(request);if(url.pathname==='/api/maps'&&r.ok){const body=await r.json();return json(body.data)}return r}catch(e){if(request.signal.aborted)throw e;return json({status:'disconnected',error:e instanceof Error?e.message:'Préproduction indisponible'},503)}
}
const banner=document.createElement('aside');banner.textContent='PRÉPRODUCTION LOCALE V0.1 — calcul GTFS dans le navigateur. Trafic et temps réel non connectés. IGN externe à la demande ; les adresses saisies lui sont transmises.';banner.style.cssText='padding:12px;background:#fff0cc;color:#153447;font:14px system-ui';document.body.prepend(banner)
void import('../../src/main.tsx')
