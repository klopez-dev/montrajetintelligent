import {loadStaticDatabase,validateManifest} from './load.ts'
import type {LoadMetric} from './load.ts'
import type {Manifest} from './model.ts'
import type {StaticDatabase} from './database.ts'
import {createJourneyPlanner} from '../../server/journeys/planner.ts'
import {createMobilityPlanner} from '../../server/mobility/planner.ts'
import type {GeographicProvider} from '../../server/mobility/provider.ts'
import type {MobilityQuery} from '../../src/types/mobility.ts'
import type {ProgressObserver} from '../../src/types/searchProgress.ts'
import type {RoutingQuery} from '../../src/types/journey.ts'

/** One serial calculation at a time. No unbounded compressed response cache.
 * Terminating its owning Worker is the cancellation boundary for synchronous work.
 */
export class HybridRuntime {
  db?:StaticDatabase
  planner?:ReturnType<typeof createJourneyPlanner>
  mobility?:ReturnType<typeof createMobilityPlanner>
  provider?:GeographicProvider
  version=''
  bytes=0
  requests=0
  metrics:LoadMetric[]=[]
  busy=false
  versionPointer:boolean
  constructor(readonlySource:(file:string)=>Promise<Response>,provider?:GeographicProvider,versionPointer=false){this.source=readonlySource;this.provider=provider;this.versionPointer=versionPointer}
  source:(file:string)=>Promise<Response>
  async read(file:string,limit:number){
    const response=await this.source(file);this.requests++
    if(!response.ok)throw new Error(`Données GTFS indisponibles : HTTP ${response.status} (${file})`)
    if(Number(response.headers.get('Content-Length'))>limit)throw new Error('Réponse GTFS trop volumineuse')
    const reader=response.body?.getReader();if(!reader)throw new Error('Réponse GTFS vide')
    const chunks:Uint8Array[]=[];let size=0
    try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>limit)throw new Error('Réponse GTFS trop volumineuse');chunks.push(r.value)}}finally{await reader.cancel()}
    const output=new Uint8Array(size);let offset=0;for(const c of chunks){output.set(c,offset);offset+=c.length}this.bytes+=size;return output
  }
  async search(query:RoutingQuery|MobilityQuery,progress?:ProgressObserver){
    if(this.busy)throw new Error('Un calcul est déjà en cours dans ce worker')
    this.busy=true;const started=performance.now();this.metrics=[]
    try{
      let expected='',unchanged=false
      if(this.versionPointer&&this.version){
        const at=performance.now()
        try{
          const bytes=await this.read('version.json',4096),pointer=JSON.parse(new TextDecoder().decode(bytes))
          if(pointer.schema!==2||!/^[a-f0-9]{64}$/.test(pointer.manifestSha256)||!/^[a-f0-9]{64}$/.test(pointer.feedSha256))throw new Error('Pointeur de version incompatible')
          expected=pointer.manifestSha256;unchanged=expected===this.version
          if(unchanged&&pointer.feedSha256!==this.db?.catalog.metadata.sha256)throw new Error('Versions GTFS mélangées')
          this.metrics.push({phase:'version',file:'version.json',ms:performance.now()-at,compressed:bytes.length,raw:bytes.length,observedAt:Date.now()})
        }catch(e){if(!(e instanceof Error)||!e.message.includes('HTTP 404'))throw e} // Legacy packages have no optional pointer.
      }
      if(!unchanged){
        const at=performance.now(),manifestBytes=await this.read('manifest.json',1000000),manifest=JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest
        validateManifest(manifest)
        const version=[...new Uint8Array(await crypto.subtle.digest('SHA-256',manifestBytes.buffer))].map(n=>n.toString(16).padStart(2,'0')).join('')
        if(expected&&version!==expected)throw new Error('Le manifeste ne correspond pas à la version annoncée ; réessayez')
        this.metrics.push({phase:'manifest',file:'manifest.json',ms:performance.now()-at,compressed:manifestBytes.length,raw:manifestBytes.length,observedAt:Date.now()})
        if(version!==this.version){
          this.release()
          this.db=await loadStaticDatabase(manifest,file=>this.read(file,32000000),m=>this.metrics.push({...m,observedAt:Date.now()}))
          this.db.onIndex=(date,ms)=>this.metrics.push({phase:'index',file:date,ms,compressed:0,raw:0,observedAt:Date.now()})
          this.planner=createJourneyPlanner(this.db);if(this.provider)this.mobility=createMobilityPlanner(this.db,this.provider);this.version=version
        }
      }
      const calculation=performance.now()
      if('from'in query&&!this.mobility)throw new Error('Le relais IGN existant est requis pour les adresses et marches')
      const result='from'in query?await this.mobility!.search(query,undefined,progress):await this.planner!.search(query,[],undefined,undefined,progress),calculationMs=performance.now()-calculation
      const serial=performance.now(),resultBytes=new TextEncoder().encode(JSON.stringify(result)).length,serializationMs=performance.now()-serial
      return{result,elapsedMs:performance.now()-started,calculationMs,serializationMs,resultBytes,compressedBytes:this.bytes,requests:this.requests,version:this.version,residentDays:[...this.db!.packets.keys()],metrics:this.metrics}
    }finally{this.busy=false}
  }
  release(){this.db?.release();this.db=undefined;this.planner=undefined;this.mobility=undefined;this.version=''}
}
