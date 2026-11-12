import type { QueryDatabase } from '../../server/gtfs/repository.ts'
import type { Catalog } from './model.ts'
const missing=0xffffffff
interface Day {date:string;origin:number;lower:number;upper:number}
export class DayPacket {
  trips: Catalog['trips']
  data:Uint32Array; starts:Int32Array; ends:Int32Array; offsets:Uint32Array; stopRecords:Uint32Array
  constructor(buffer:ArrayBuffer,tripCount:number,stopCount:number,trips:Catalog['trips']=[]){
    this.trips=trips
    if(new Uint8Array(new Uint32Array([1]).buffer)[0]!==1)throw new Error('Architecture big-endian non prise en charge par ce format expérimental')
    if(buffer.byteLength%28)throw new Error('Partition horaire tronquée')
    this.data=new Uint32Array(buffer);this.starts=new Int32Array(tripCount).fill(-1);this.ends=new Int32Array(tripCount).fill(-1)
    const counts=new Uint32Array(stopCount)
    let lastTrip=-1,lastSequence=-1
    for(let n=0;n<this.data.length;n+=7){
      const trip=this.data[n],stop=this.data[n+1],sequence=this.data[n+2]
      if(trip>=tripCount||stop>=stopCount||trip<lastTrip||(trip===lastTrip&&sequence<=lastSequence))throw new Error('Ordre ou identifiant de partition invalide')
      if(this.starts[trip]===-1)this.starts[trip]=n;this.ends[trip]=n+7;counts[stop]++;lastTrip=trip;lastSequence=sequence
    }
    this.offsets=new Uint32Array(stopCount+1)
    for(let i=0;i<stopCount;i++)this.offsets[i+1]=this.offsets[i]+counts[i]
    this.stopRecords=new Uint32Array(this.data.length/7)
    const positions=this.offsets.slice()
    for(let n=0;n<this.data.length;n+=7)this.stopRecords[positions[this.data[n+1]]++]=n
  }
  indices(stop:number){return this.stopRecords.subarray(this.offsets[stop],this.offsets[stop+1])}
}
/** Experimental adapter for the current network-planner queries, not a SQL interpreter.
 * Unknown queries fail; no SQLite or provider fallback can silently supply the result.
 */
export class StaticDatabase implements QueryDatabase {
  stopIndices:Map<string,number>; packets=new Map<string,Promise<DayPacket>>(); calls=0;eventMs=0
  catalog:Catalog; readDay:(date:string)=>Promise<ArrayBuffer>; readTrips?: (date:string)=>Promise<Catalog['trips']>
  onIndex?:(date:string,ms:number)=>void
  packetIdentity?:(date:string)=>string
  constructor(catalog:Catalog,readDay:(date:string)=>Promise<ArrayBuffer>,readTrips?:(date:string)=>Promise<Catalog['trips']>){this.catalog=catalog;this.readDay=readDay;this.readTrips=readTrips;this.stopIndices=new Map(catalog.stops.map((s,i)=>[String(s.id),i]))}
  release(){this.packets.clear()}
  async packet(date:string){
    let value=this.packets.get(date)
    if(value){this.packets.delete(date);this.packets.set(date,value)}
    else{
      if(this.packetIdentity){const identity=this.packetIdentity(date);for(const [other,promise]of this.packets)if(this.packetIdentity(other)===identity){value=promise;break}}
      if(this.packets.size>=3)this.packets.delete(this.packets.keys().next().value!)
      value??=(async()=>{const trips=this.readTrips?await this.readTrips(date):this.catalog.trips,buffer=await this.readDay(date),at=performance.now(),packet=new DayPacket(buffer,trips.length,this.catalog.stops.length,trips);this.onIndex?.(date,performance.now()-at);return packet})().catch(e=>{for(const [key,promise]of this.packets)if(promise===value)this.packets.delete(key);throw e})
      this.packets.set(date,value)
    }
    return value
  }
  async all<T>(raw:string,params:(string|number|null)[]=[]):Promise<T[]>{
    this.calls++;const sql=raw.replace(/\s+/g,' ').trim(),c=this.catalog
    if(sql==='SELECT json FROM metadata WHERE id=1')return [{json:JSON.stringify(c.metadata)}] as T[]
    if(sql==='SELECT id,name,parent_id,location_type FROM stops')return c.stops as T[]
    if(sql==='SELECT id,short_name,long_name,type FROM routes')return c.routes as T[]
    if(sql==='SELECT stop_id,route_id FROM route_stops')return c.memberships as T[]
    if(sql==='SELECT * FROM transfers')return c.transfers as T[]
    if(sql==='SELECT id,name,latitude,longitude FROM stops WHERE location_type=0 AND latitude IS NOT NULL AND longitude IS NOT NULL')return c.stops.filter(s=>s.location_type===0&&s.latitude!==null&&s.longitude!==null) as T[]
    if(sql.includes('WITH pairs AS')&&sql.includes('AS pairIndex')&&params.length===4){
      const pairs=JSON.parse(String(params[0])) as {from:string;to:string;routes:string[]}[],days=JSON.parse(String(params[1])) as Day[]
      const results:{pairIndex:number;tripId:string;routeId:string;directionId:string;headsign:string;serviceDate:string;fromId:string;toId:string;fromSequence:number;toSequence:number;departure:number;arrival:number;departureSeconds:number;arrivalSeconds:number;fromTimepoint:number;toTimepoint:number}[]=[]
      for(let pairIndex=0;pairIndex<pairs.length;pairIndex++){
        const pair=pairs[pairIndex],stop=this.stopIndices.get(pair.from);if(stop===undefined)continue
        for(const day of days){const packet=await this.packet(day.date),a=packet.data
          for(const n of packet.indices(stop)){
            const trip=a[n],info=packet.trips[trip],departure=a[n+4]
            if(!pair.routes.includes(info[1])||departure===missing||(a[n+6]&255)!==0||departure<day.lower||departure>day.upper)continue
            for(let end=n+7;end<packet.ends[trip];end+=7){const arrival=a[end+3],absolute=day.origin+arrival*1000
              if(String(c.stops[a[end+1]].id)!==pair.to||((a[end+6]>>8)&255)!==0||arrival===missing||arrival<departure||absolute<Number(params[2])||absolute>Number(params[3]))continue
              results.push({pairIndex,tripId:info[0],routeId:info[1],directionId:info[3],headsign:c.headsigns[a[n+5]]||info[4],serviceDate:day.date,fromId:pair.from,toId:pair.to,fromSequence:a[n+2],toSequence:a[end+2],departure:day.origin+departure*1000,arrival:absolute,departureSeconds:departure,arrivalSeconds:arrival,fromTimepoint:(a[n+6]>>16)&255,toTimepoint:(a[end+6]>>16)&255})
            }
          }
        }
      }
      results.sort((a,b)=>a.departure-b.departure||a.arrival-b.arrival||(a.tripId<b.tripId?-1:a.tripId>b.tripId?1:0)||a.fromSequence-b.fromSequence||a.toSequence-b.toSequence)
      return results.slice(0,20001) as T[]
    }
    if(sql.includes('candidates AS MATERIALIZED')&&sql.includes('boards AS')&&params.length===5){
      const started=performance.now(),days=JSON.parse(String(params[0])) as Day[],boards=JSON.parse(String(params[1])) as {id:string;threshold:number}[],routes=new Set<string>(JSON.parse(String(params[2]))),needed=new Set<string>(JSON.parse(String(params[3]))),limit=Number(params[4]),reverse=sql.includes('st.sequence DESC')
      const result:unknown[]=[]
      for(const day of days){
        const packet=await this.packet(day.date),a=packet.data,candidates=new Set<number>()
        for(const board of boards){
          const stop=this.stopIndices.get(board.id);if(stop===undefined)continue
          for(const n of packet.indices(stop)){
            const trip=a[n],time=a[n+(reverse?3:4)],flag=reverse?(a[n+6]>>8)&255:a[n+6]&255
            if(time!==missing&&flag===0&&time>=day.lower&&time<=day.upper&&routes.has(packet.trips[trip][1])&&(reverse?day.origin+time*1000<=board.threshold:day.origin+time*1000>=board.threshold))candidates.add(trip)
          }
        }
        for(const trip of [...candidates].sort((a,b)=>a-b)){
          const info=packet.trips[trip],start=packet.starts[trip],end=packet.ends[trip]
          for(let n=reverse?end-7:start;reverse?n>=start:n<end;n+=reverse?-7:7){
            const stop=c.stops[a[n+1]];if(!needed.has(String(stop.id)))continue
            result.push({tripId:info[0],routeId:info[1],directionId:info[3],tripHeadsign:info[4],serviceDate:day.date,origin:day.origin,stopId:stop.id,sequence:a[n+2],arrival:a[n+3]===missing?null:a[n+3],departure:a[n+4]===missing?null:a[n+4],headsign:c.headsigns[a[n+5]],pickup:a[n+6]&255,dropoff:(a[n+6]>>8)&255,timepoint:(a[n+6]>>16)&255})
            if(result.length===limit){this.eventMs+=performance.now()-started;return result as T[]}
          }
        }
      }
      this.eventMs+=performance.now()-started;return result as T[]
    }
    if(sql.includes('SELECT DISTINCT st.stop_id AS stopId,t.route_id AS routeId')&&params.length===2){
      const days=JSON.parse(String(params[0])) as Day[],ids=JSON.parse(String(params[1])) as string[],incoming=sql.includes('st.arrival BETWEEN'),seen=new Set<string>(),result:unknown[]=[]
      for(const id of ids)for(const day of days){
        const stop=this.stopIndices.get(id);if(stop===undefined)continue
        const packet=await this.packet(day.date),a=packet.data
        for(const n of packet.indices(stop)){
          const time=a[n+(incoming?3:4)],flag=incoming?(a[n+6]>>8)&255:a[n+6]&255,route=packet.trips[a[n]][1],key=JSON.stringify([id,route])
          if(time!==missing&&flag===0&&time>=day.lower&&time<=day.upper&&!seen.has(key)){seen.add(key);result.push({stopId:id,routeId:route})}
        }
      }
      return result as T[]
    }
    throw new Error('Requête non prise en charge par le prototype statique : '+sql.slice(0,100))
  }
}
