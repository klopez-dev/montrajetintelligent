import {GeographicError} from '../../server/mobility/provider.ts'
import type {GeographicProvider,GeographicTrace} from '../../server/mobility/provider.ts'
export type GeographicMethod='addresses'|'resolveAddress'|'walk'
export function geographicProxy(request:(method:GeographicMethod,args:unknown[],signal?:AbortSignal)=>Promise<{value:unknown;trace?:GeographicTrace}>):GeographicProvider{
 async function call(method:GeographicMethod,args:unknown[],trace?:GeographicTrace,signal?:AbortSignal){
   const result=await request(method,args,signal)
   if(trace&&result.trace)for(const key of Object.keys(trace) as (keyof GeographicTrace)[])trace[key]+=result.trace[key]||0
   return result.value
 }
 return{addresses:(q,t,s)=>call('addresses',[q],t,s) as ReturnType<GeographicProvider['addresses']>,resolveAddress:(id,name,t,s)=>call('resolveAddress',[id,name],t,s) as Promise<Awaited<ReturnType<NonNullable<GeographicProvider['resolveAddress']>>>>,walk:(a,b,t,s)=>call('walk',[a,b],t,s) as ReturnType<GeographicProvider['walk']>}
}
export function httpGeographicProvider(base='/prototype/mobility/geography',fetcher:typeof fetch=fetch):GeographicProvider{
 return geographicProxy(async(method,args,signal)=>{
  const response=await fetcher(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)})
  const body=await response.json();if(!response.ok)throw new GeographicError(body.error||`Relais IGN indisponible (HTTP ${response.status})`);return body
 })
}
