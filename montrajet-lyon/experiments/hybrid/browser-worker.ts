import {HybridRuntime} from './runtime.ts'
import type {RoutingQuery} from '../../src/types/journey.ts'
import type {MobilityQuery} from '../../src/types/mobility.ts'
import {httpGeographicProvider} from './geographic-rpc.ts'
const scope=globalThis as unknown as {onmessage:(e:MessageEvent)=>void;postMessage:(data:unknown)=>void}
const runtime=new HybridRuntime(file=>fetch('/prototype-data/'+file,{cache:'no-store',signal:AbortSignal.timeout(30000)}),httpGeographicProvider(),true)
scope.postMessage({ready:true})
scope.onmessage=async(e:MessageEvent<{id:number;query:RoutingQuery|MobilityQuery;command?:string;trackProgress?:boolean}>)=>{
  const {id,query,command}=e.data
  try{
    if(command==='release'){if(runtime.busy)throw new Error('Annulez le calcul avant de libérer les données');runtime.release();scope.postMessage({id,released:true});return}
    scope.postMessage({id,...await runtime.search(query,e.data.trackProgress?event=>scope.postMessage({id,progress:event}):undefined)})
  }catch(e){scope.postMessage({id,error:e instanceof Error?e.message:'Prototype indisponible'})}
}
