import type {ExperimentalQuery} from './engine-selector.ts'
import type {ProgressObserver} from '../../src/types/searchProgress.ts'
import type {HybridRuntime} from './runtime.ts'
export class HybridClient{
 worker?:Worker
 private sequence=0
 private pending?:{reject:(e:Error)=>void;cleanup:()=>void}
 cancel(){this.sequence++;this.worker?.terminate();this.worker=undefined;const previous=this.pending;this.pending=undefined;previous?.cleanup();previous?.reject(new DOMException('Recherche annulée','AbortError'))}
 search(query:ExperimentalQuery,signal?:AbortSignal,progress?:ProgressObserver):Promise<Awaited<ReturnType<HybridRuntime['search']>>>{
  if(signal?.aborted)return Promise.reject(signal.reason)
  if(this.pending)this.cancel()
  const id=++this.sequence
  return new Promise((resolve,reject)=>{
   const abort=()=>this.cancel(),cleanup=()=>signal?.removeEventListener('abort',abort)
   this.pending={reject,cleanup};signal?.addEventListener('abort',abort,{once:true})
   try{
    this.worker??=new Worker(new URL('./browser-worker.ts',import.meta.url),{type:'module'})
    this.worker.onmessage=e=>{
     if(id!==this.sequence||e.data.id!==id)return
     if(e.data.progress){progress?.(e.data.progress);return}
     cleanup();this.pending=undefined
     if(e.data.error)reject(new Error(e.data.error));else resolve(e.data)
    }
    this.worker.onerror=()=>{if(id!==this.sequence)return;this.worker?.terminate();this.worker=undefined;cleanup();this.pending=undefined;reject(new Error('Le Worker a échoué ; aucune estimation de trajet créée'))}
    this.worker.postMessage({id,query,trackProgress:Boolean(progress)})
   }catch(e){this.worker?.terminate();this.worker=undefined;cleanup();this.pending=undefined;reject(e)}
  })
 }
}
