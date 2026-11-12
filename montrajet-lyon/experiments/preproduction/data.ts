import type {StaticDatabase} from '../hybrid/database.ts'
import {normalizeSearch} from '../../server/gtfs/time.ts'
import {getPassages} from '../../server/gtfs/repository.ts'
import type {QueryDatabase} from '../../server/gtfs/repository.ts'
import type {Asset} from '../hybrid/model.ts'
export interface ExtraCatalog {tripDates:Record<string,string>;directions:{stopId:string;lineId:string;id:string;headsign:string}[]}
export interface PreproductionConfig {schema:1;feedSha256:string;extra:Asset;mode:'direct-ign';traffic:'unavailable'}
const compare=(a:unknown,b:unknown)=>String(a)<String(b)?-1:String(a)>String(b)?1:0
export class StaticConsultation{
 db:StaticDatabase;extra:()=>Promise<ExtraCatalog>
 constructor(db:StaticDatabase,extra:()=>Promise<ExtraCatalog>){this.db=db;this.extra=extra}
 stop(row:Record<string,unknown>){return{id:String(row.id),name:String(row.name),code:String(row.code),platform:String(row.platform),parentId:String(row.parent_id),latitude:row.latitude,longitude:row.longitude}}
 lines(q=''){const key=normalizeSearch(q).slice(0,80);if(!key)return[];return this.db.catalog.routes.filter(r=>[r.id,r.short_name,r.long_name].some(v=>this.matches(String(v),key))).sort((a,b)=>Number(b.short_name===q.trim())-Number(a.short_name===q.trim())||String(a.short_name).length-String(b.short_name).length||compare(a.short_name,b.short_name)||compare(a.id,b.id)).slice(0,20).map(r=>({id:r.id,name:r.short_name||r.long_name,shortName:r.short_name,longName:r.long_name,type:r.type}))}
 matches(value:string,key:string){const words=normalizeSearch(value).split(' ');return words.some((_,i)=>words.slice(i).join(' ').startsWith(key))}
 stops(q='',lineId='',id=''){
  const key=normalizeSearch(q).slice(0,80),allowed=lineId?new Set(this.db.catalog.memberships.filter(m=>m.route_id===lineId).map(m=>m.stop_id)):null
  return this.db.catalog.stops.filter(s=>s.location_type===0&&(id?s.id===id:Boolean(key)&&[s.id,s.name,s.code].some(v=>this.matches(String(v),key)))&&(!allowed||allowed.has(s.id))).sort((a,b)=>compare(a.name,b.name)||compare(a.code,b.code)||compare(a.id,b.id)).slice(0,20).map(s=>this.stop(s))
 }
 journeyStops(q='',id=''){return this.stops(q,'',id).map(s=>({...s,lines:this.db.catalog.memberships.filter(m=>m.stop_id===s.id).map(m=>this.db.catalog.routes.find(r=>r.id===m.route_id)!).filter(Boolean).sort((a,b)=>compare(a.short_name,b.short_name)||compare(a.id,b.id)).map(r=>({id:r.id,name:r.short_name||r.long_name}))}))}
 async passages(lineId:string,stopId:string,instant:number){
  const database:QueryDatabase={all:async<T>(sql:string,parameters:(string|number|null)[]=[])=>{
   if(sql==='SELECT json FROM metadata WHERE id=1')return this.db.all<T>(sql,parameters)
   if(!sql.includes('WITH days AS')||!sql.includes('AS gtfsSeconds'))throw new Error('Consultation horaire inconnue')
   const days=JSON.parse(String(parameters[0])) as {date:string;origin:number;lower:number;upper:number}[],stop=this.db.stopIndices.get(String(parameters[1])),rows:(Record<string,unknown>&{epoch:number;tripId:string;sequence:number})[]=[]
   if(stop===undefined)return[]
   for(const day of days){const packet=await this.db.packet(day.date),a=packet.data;for(const n of packet.indices(stop)){const t=packet.trips[a[n]],time=a[n+4];if(t[1]!==parameters[2]||time===0xffffffff||time<day.lower||time>=day.upper||(a[n+6]&255)===1)continue;rows.push({tripId:t[0],stopId:String(parameters[1]),lineId:t[1],directionId:t[3],headsign:this.db.catalog.headsigns[a[n+5]]||t[4],serviceDate:day.date,gtfsSeconds:time,timepoint:(a[n+6]>>16)&255,pickupType:a[n+6]&255,epoch:day.origin+time*1000,sequence:a[n+2]})}}
   rows.sort((a,b)=>a.epoch-b.epoch||compare(a.tripId,b.tripId)||a.sequence-b.sequence)
   return rows.slice(0,12).map(({sequence:_sequence,...row})=>row) as T[]
  }}
  return getPassages(database,lineId,stopId,instant)
 }
 async directions(lineId:string,stopId:string){return(await this.extra()).directions.filter(d=>d.lineId===lineId&&d.stopId===stopId).map(({id,headsign})=>({id,headsign})).slice(0,50)}
 async map(body:{feedSha256:string;legs:{tripId:string;fromSequence:number;toSequence:number;fromStopId:string;toStopId:string}[]}){
  if(body.feedSha256!==this.db.catalog.metadata.sha256)throw new Error('Version cartographique incompatible ; recalculez le trajet')
  if(!Array.isArray(body.legs)||body.legs.length<1||body.legs.length>3)throw new Error('Références cartographiques invalides')
  const extra=await this.extra(),legs=[]
  for(const leg of body.legs){if(!Number.isSafeInteger(leg.fromSequence)||!Number.isSafeInteger(leg.toSequence)||leg.toSequence<=leg.fromSequence)throw new Error('Séquences invalides');const date=extra.tripDates[leg.tripId];if(!date)throw new Error('Course cartographique absente');const packet=await this.db.packet(date),trip=packet.trips.findIndex(t=>t[0]===leg.tripId),t=packet.trips[trip],stops=[]
   for(let n=packet.starts[trip];n<packet.ends[trip];n+=7){const sequence=packet.data[n+2];if(sequence<leg.fromSequence||sequence>leg.toSequence)continue;const s=this.db.catalog.stops[packet.data[n+1]];stops.push({id:s.id,name:s.name,latitude:s.latitude,longitude:s.longitude,sequence})}
   if(stops.length<2||stops.length>400||stops[0].id!==leg.fromStopId||stops[0].sequence!==leg.fromSequence||stops.at(-1)!.id!==leg.toStopId||stops.at(-1)!.sequence!==leg.toSequence)throw new Error('Quais cartographiques invalides')
   const r=this.db.catalog.routes.find(r=>r.id===t[1])!;legs.push({tripId:t[0],routeId:t[1],lineName:r.short_name||r.long_name,routeType:r.type,headsign:t[4],stops,color:null,geometry:null,geometryStatus:'unavailable'})
  }
  return{feedSha256:body.feedSha256,legs,durationMs:0,warning:'Tracés de transport absents du GTFS ; seuls les arrêts officiels sont représentés.'}
 }
}
