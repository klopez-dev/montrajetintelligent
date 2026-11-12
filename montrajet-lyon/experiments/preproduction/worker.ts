import {HybridRuntime} from '../hybrid/runtime.ts'
import {loadStaticDatabase,decodeAsset} from '../hybrid/load.ts'
import {createJourneyPlanner} from '../../server/journeys/planner.ts'
import {createMobilityPlanner} from '../../server/mobility/planner.ts'
import {createIgnProvider} from '../../server/mobility/provider.ts'
import {StaticConsultation} from './data.ts'
import type {PreproductionConfig,ExtraCatalog} from './data.ts'
import {validateSearch} from './validation.ts'
import {parseVersionPointer} from './version.ts'
const scope=globalThis as unknown as {onmessage:(e:MessageEvent)=>void;postMessage:(v:unknown)=>void}
function trace(event:Record<string,unknown>){scope.postMessage({diagnostic:{...event,at:new Date().toISOString()}})}
const provider=createIgnProvider(async(input,options)=>{const u=new URL(input instanceof Request?input.url:String(input)),at=performance.now();try{const response=await fetch(input,options);trace({kind:'ign',endpoint:u.origin+u.pathname,method:options?.method||'GET',status:response.status,responseType:response.type,ms:performance.now()-at});return response}catch(e){trace({kind:'ign',endpoint:u.origin+u.pathname,error:'Réseau ou annulation',ms:performance.now()-at});throw e}}),runtime=new HybridRuntime(async f=>{const at=performance.now();try{const response=await fetch('/prototype-data/'+f,{cache:'no-store',signal:AbortSignal.timeout(30000)});trace({kind:'static',file:f,status:response.status,ms:performance.now()-at});return response}catch(e){trace({kind:'static',file:f,error:'Réseau ou annulation',ms:performance.now()-at});throw e}},provider,true)
let initializing:Promise<StaticConsultation>|undefined,extras:Promise<ExtraCatalog>|undefined
const controllers=new Map<number,AbortController>()
async function consultation():Promise<StaticConsultation>{
 if(initializing){const current=await initializing;if(current.db===runtime.db)return current;initializing=undefined;extras=undefined}
 return initializing??=(async()=>{
 if(!runtime.db){
 const manifestBytes=await runtime.read('manifest.json',1000000),manifest=JSON.parse(new TextDecoder().decode(manifestBytes))
 const db=await loadStaticDatabase(manifest,f=>runtime.read(f,32000000),metric=>trace({kind:'load',...metric}))
 db.onIndex=(date,ms)=>trace({kind:'index',date,ms})
 runtime.db=db;runtime.planner=createJourneyPlanner(db);runtime.mobility=createMobilityPlanner(db,provider);runtime.version=[...new Uint8Array(await crypto.subtle.digest('SHA-256',manifestBytes.buffer))].map(n=>n.toString(16).padStart(2,'0')).join('')
 }
 const db=runtime.db
 return new StaticConsultation(db,()=>extras??=(async()=>{const response=await fetch('/preproduction.json',{cache:'no-store'});if(!response.ok)throw new Error('Configuration statique indisponible');const text=await response.text();if(text.length>40000)throw new Error('Configuration trop grande');const config=JSON.parse(text) as PreproductionConfig;if(config.schema!==1||config.feedSha256!==db.catalog.metadata.sha256||!/^[a-f0-9]{64}\.consultation\.gz$/.test(config.extra?.file))throw new Error('Version de préproduction incompatible');const bytes=await runtime.read(config.extra.file,32000000);return JSON.parse(new TextDecoder().decode(await decodeAsset(bytes,config.extra))) as ExtraCatalog})().catch(e=>{extras=undefined;throw e}))
})().catch(e=>{initializing=undefined;throw e})}
let checking:Promise<StaticConsultation>|undefined
async function verifiedConsultation(){return checking??=(async()=>{
 const data=await consultation(),bytes=await runtime.read('version.json',4096)
 const pointer=parseVersionPointer(bytes)
 if(pointer.manifestSha256===runtime.version&&pointer.feedSha256===data.db.catalog.metadata.sha256)return data
 runtime.release();initializing=undefined;extras=undefined;const fresh=await consultation()
 if(runtime.version!==pointer.manifestSha256||fresh.db.catalog.metadata.sha256!==pointer.feedSha256)throw new Error('Versions GTFS incohérentes ; réessayez la consultation')
 return fresh
})().finally(()=>{checking=undefined})}
scope.onmessage=async e=>{const{id,op,args}=e.data;try{
 if(op==='cancel'){controllers.get(args.id)?.abort();return}
 const started=performance.now();trace({kind:'operation',phase:'start',id,op});let result:unknown
 if(op==='addresses'){const controller=new AbortController();controllers.set(id,controller);result=await provider.addresses(String(args.q||''),undefined,controller.signal)}
 else if(op==='search'){validateSearch(args);await verifiedConsultation();result=(await runtime.search(args,event=>scope.postMessage({id,progress:event}))).result}
 else{const data=await verifiedConsultation();switch(op){case'status':result=data.db.catalog.metadata;break;case'lines':result=data.lines(args.q);break;case'stops':result=data.stops(args.q,args.lineId);break;case'journeyStops':result=data.journeyStops(args.q,args.id);break;case'directions':result=await data.directions(args.lineId,args.stopId);break;case'passages':result=await data.passages(args.lineId,args.stopId,Date.parse(args.at||new Date().toISOString()));break;case'maps':result=await data.map(args);break;default:throw new Error('Opération statique inconnue')}}
 trace({kind:'operation',phase:'end',id,op,ms:performance.now()-started,engine:'worker',feedSha256:runtime.db?.catalog.metadata.sha256,residentDays:runtime.db?[...runtime.db.packets.keys()]:[],dataRequests:runtime.requests,dataBytes:runtime.bytes})
 scope.postMessage({id,result})
 }catch(e){scope.postMessage({id,error:e instanceof Error?e.message:'Préproduction indisponible'})}finally{controllers.delete(id)}}
