import type { Asset, Catalog, Manifest } from './model.ts'
import { StaticDatabase } from './database.ts'
export interface LoadMetric {phase:string;file:string;ms:number;compressed:number;raw:number;observedAt?:number}
export type MetricObserver=(metric:LoadMetric)=>void
export function validateManifest(manifest:Manifest){
  if(!manifest||![1,2].includes(manifest.format)||!manifest.days||!manifest.catalog||!/^[a-f0-9]{64}$/.test(manifest.feedSha256))throw new Error('Format ou version de données incompatible')
  const files=new Map<string,string>()
  const check=(asset:Asset)=>{
    if(!asset||!/^[-a-zA-Z0-9_.]+$/.test(asset.file)||!/^[a-f0-9]{64}$/.test(asset.sha256)||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>32000000||!Number.isSafeInteger(asset.rawBytes)||asset.rawBytes<0||asset.rawBytes>32000000)throw new Error('Manifeste de partition invalide')
    const identity=JSON.stringify([asset.sha256,asset.bytes,asset.rawBytes])
    if(files.has(asset.file)&&files.get(asset.file)!==identity)throw new Error('Versions de partitions mélangées')
    files.set(asset.file,identity)
  }
  check(manifest.catalog)
  for(const [date,asset]of Object.entries(manifest.days)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Date de partition invalide')
    check(asset);if(manifest.format===2){if(!asset.trips)throw new Error('Index de courses manquant');check(asset.trips)}
  }
}
export async function decodeAsset(bytes:Uint8Array,asset:Asset,observe?:MetricObserver):Promise<ArrayBuffer>{
  const started=performance.now()
  if(bytes.byteLength!==asset.bytes||asset.rawBytes>32000000||asset.rawBytes<0)throw new Error('Taille de partition invalide')
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>))].map(n=>n.toString(16).padStart(2,'0')).join('')
  if(hash!==asset.sha256)throw new Error('Empreinte de partition incorrecte')
  // One preallocated destination; no retained chunks or compressed copy/Blob.
  const stream=new ReadableStream<Uint8Array<ArrayBuffer>>({start(controller){controller.enqueue(bytes as Uint8Array<ArrayBuffer>);controller.close()}}).pipeThrough(new DecompressionStream('gzip'))
  const reader=stream.getReader(),output=new Uint8Array(asset.rawBytes);let offset=0
  try{while(true){const r=await reader.read();if(r.done)break;if(offset+r.value.length>output.length)throw new Error('Expansion de partition invalide');output.set(r.value,offset);offset+=r.value.length}}finally{await reader.cancel()}
  if(offset!==output.length)throw new Error('Partition incomplète')
  observe?.({phase:'decode',file:asset.file,ms:performance.now()-started,compressed:bytes.byteLength,raw:offset})
  return output.buffer
}
export async function loadStaticDatabase(manifest:Manifest,read:(file:string)=>Promise<Uint8Array>,observe?:MetricObserver){
  validateManifest(manifest)
  async function decoded(asset:Asset){const at=performance.now(),bytes=await read(asset.file);observe?.({phase:'read',file:asset.file,ms:performance.now()-at,compressed:bytes.length,raw:asset.rawBytes});return decodeAsset(bytes,asset,observe)}
  const started=performance.now(),catalog=JSON.parse(new TextDecoder().decode(await decoded(manifest.catalog))) as Catalog
  if(!catalog?.metadata||catalog.metadata.sha256!==manifest.feedSha256)throw new Error('Versions GTFS mélangées')
  if(catalog.metadata.schemaVersion!==1||!/^\d{4}-\d{2}-\d{2}$/.test(catalog.metadata.validFrom)||!/^\d{4}-\d{2}-\d{2}$/.test(catalog.metadata.validUntil)||catalog.metadata.validFrom>catalog.metadata.validUntil||!Number.isFinite(catalog.metadata.maxDepartureSeconds)||catalog.metadata.maxDepartureSeconds<0)throw new Error('Métadonnées GTFS incompatibles')
  new Intl.DateTimeFormat('fr-FR',{timeZone:catalog.metadata.timezone})
  if(!Array.isArray(catalog.stops)||!Array.isArray(catalog.routes)||!Array.isArray(catalog.trips)||!Array.isArray(catalog.headsigns)||!Array.isArray(catalog.memberships)||!Array.isArray(catalog.transfers)||new Set(catalog.stops.map(s=>s.id)).size!==catalog.stops.length)throw new Error('Catalogue invalide')
  observe?.({phase:'catalog',file:manifest.catalog.file,ms:performance.now()-started,compressed:manifest.catalog.bytes,raw:manifest.catalog.rawBytes})
  function day(date:string){const asset=manifest.days[date];if(!asset)throw new Error('Jour de service non compilé : '+date+' ; aucun résultat inventé');return asset}
  const db=new StaticDatabase(catalog,date=>decoded(day(date)),manifest.format===2?async date=>{
    const trips=JSON.parse(new TextDecoder().decode(await decoded(day(date).trips!))) as Catalog['trips']
    if(!Array.isArray(trips)||trips.some((t,i)=>!Array.isArray(t)||t.length!==5||t.some(v=>typeof v!=='string')||(i>0&&trips[i-1][0]>=t[0])))throw new Error('Index de courses invalide')
    return trips
  }:undefined)
  db.packetIdentity=date=>JSON.stringify([day(date).sha256,day(date).trips?.sha256??manifest.catalog.sha256])
  return db
}
