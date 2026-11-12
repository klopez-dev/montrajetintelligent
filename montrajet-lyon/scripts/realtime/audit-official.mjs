import { DatabaseSync } from 'node:sqlite'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadLocalCredential } from '../../server/realtime/credentials.ts'
import { GRANDLYON_URL } from '../../server/realtime/config.ts'
import { parseProviderRow } from '../../server/realtime/mapping.ts'
import { providerInstant } from '../../server/realtime/time.ts'
import { addDays, localServiceDate, normalizeSearch, serviceActive, serviceDayOrigin } from '../../server/gtfs/time.ts'

const credential=loadLocalCredential()
const sample=process.argv.includes('--sample')
const lineOption=process.argv.indexOf('--line')
const line=lineOption>=0?process.argv[lineOption+1]:'T3'
const stopOption=process.argv.indexOf('--stop')
const stop=stopOption>=0?process.argv[stopOption+1]:null
const exact=process.argv.includes('--exact')
if(stop!==null&&!/^[A-Za-z0-9_-]{1,40}$/.test(stop))throw Error('Invalid stop ID')
const filter=sample?{maxfeatures:20}:stop!==null?{id__eq:stop,maxfeatures:20}:exact?{ligne__eq:line,maxfeatures:20}:{field:'ligne',value:line,maxfeatures:20}
if(!/^[A-Z0-9]{1,6}$/.test(line))throw Error('Code de ligne invalide pour cet audit ciblé.')
const report={checkedAt:new Date().toISOString(),endpoint:GRANDLYON_URL,filter,credentialStore:credential?'DPAPI ou coffre local Windows lisible':'indisponible',http:null,contentType:null,authentication:'non vérifiée',rows:0,nbResults:null,matches:null,limits:[]}
if(!credential){report.limits.push('Coffre local absent ou illisible.');console.log(JSON.stringify(report));process.exit(1)}
const url=new URL(GRANDLYON_URL);url.search=new URLSearchParams(report.filter).toString()
const token=Buffer.from(`${credential.username}:${credential.password}`,'utf8').toString('base64')
try{
 const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json',Authorization:`Basic ${token}`}})
 report.http=response.status;report.contentType=response.headers.get('content-type');report.authentication=response.status===200?'acceptée':response.status===401?'refusée (401)':response.status===403?'accès interdit (403)':'non établie'
 if(response.status===200){
  const declared=Number(response.headers.get('content-length')||0)
  if(declared>2_000_000)throw Error('Réponse trop volumineuse pour cet audit ciblé')
  const body=await response.text();if(Buffer.byteLength(body)>2_000_000)throw Error('Réponse trop volumineuse pour cet audit ciblé')
  const payload=JSON.parse(body)
  if(!Array.isArray(payload.values))throw Error('Réponse JSON sans tableau values')
  report.rows=payload.values.length;report.nbResults=payload.nb_results??null
  const db=new DatabaseSync(resolve('.data/gtfs.sqlite'),{readOnly:true})
  try{
   const counters={parsed:0,exactStop:0,exactLineId:0,commercialCode:0,exactTrip:0,exactTripStop:0,exactTripStopLine:0,exactDestinationLater:0,exactDestinationFinal:0,directionEqualsHeadsign:0,directionEqualsDestination:0,serviceActiveNearPassage:0,theoreticalTimeExact:0,validTime:0,estimatedCode:0,theoreticalCode:0,otherCode:0}
   const samples=[],lineCodes=new Set(),updates=[]
   const stop=db.prepare('SELECT id,name,parent_id FROM stops WHERE id=? AND location_type=0')
   const route=db.prepare('SELECT id,short_name FROM routes WHERE id=?')
   const commercial=db.prepare('SELECT id,short_name FROM routes WHERE short_name=? LIMIT 2')
   const trip=db.prepare('SELECT id,route_id,headsign,service_id FROM trips WHERE id=?')
   const service=db.prepare('SELECT * FROM services WHERE id=?')
   const exception=db.prepare('SELECT exception_type FROM calendar_dates WHERE service_id=? AND date=?')
   const boarding=db.prepare('SELECT sequence,departure FROM stop_times WHERE trip_id=? AND stop_id=? LIMIT 2')
   const destination=db.prepare('SELECT 1 FROM stop_times WHERE trip_id=? AND stop_id=? AND sequence>? LIMIT 1')
   const destinationStop=db.prepare('SELECT id,name,parent_id,location_type FROM stops WHERE id=? LIMIT 1')
   const tripFinal=db.prepare('SELECT s.id,s.name,s.parent_id FROM stop_times st JOIN stops s ON s.id=st.stop_id WHERE st.trip_id=? ORDER BY st.sequence DESC LIMIT 1')
   for(const raw of payload.values){
    const row=parseProviderRow(raw)
    if(!row)continue
    counters.parsed++
    lineCodes.add(row.ligne)
    const update=providerInstant(row.last_update_fme);if(update!==null)updates.push(update)
    const s=stop.get(row.id),r=route.get(row.ligne),c=commercial.get(row.ligne),t=trip.get(row.coursetheorique),b=t&&boarding.get(t.id,row.id)
    if(s)counters.exactStop++
    if(r)counters.exactLineId++
    if(c)counters.commercialCode++
    if(t)counters.exactTrip++
    if(b)counters.exactTripStop++
    if(b&&r&&t.route_id===r.id)counters.exactTripStopLine++
    const passage=providerInstant(row.heurepassage)
    if(t&&b&&passage!==null){
     const base=localServiceDate(passage,'Europe/Paris'),sv=service.get(t.service_id)
     for(const offset of [0,-1,-2,-3]){
      const date=addDays(base,offset),scheduled=serviceDayOrigin(date,'Europe/Paris')+b.departure*1000
      if(Math.abs(scheduled-passage)>6*3600000)continue
      const ex=exception.get(t.service_id,date)?.exception_type
      if(serviceActive(sv?{startDate:sv.start_date,endDate:sv.end_date,weekdays:[sv.monday,sv.tuesday,sv.wednesday,sv.thursday,sv.friday,sv.saturday,sv.sunday]}:undefined,date,ex)){
       counters.serviceActiveNearPassage++
       if(row.type==='T'&&Math.abs(scheduled-passage)<=60000)counters.theoreticalTimeExact++
       break
      }
     }
    }
    if(b&&destination.get(t.id,row.idtarretdestination,b.sequence))counters.exactDestinationLater++
    const destRow=destinationStop.get(row.idtarretdestination), finalRow=t&&tripFinal.get(t.id)
    if(finalRow?.id===row.idtarretdestination)counters.exactDestinationFinal++
    if(t&&normalizeSearch(t.headsign)===normalizeSearch(row.direction))counters.directionEqualsHeadsign++
    if(destRow&&normalizeSearch(destRow.name)===normalizeSearch(row.direction))counters.directionEqualsDestination++
    if(providerInstant(row.heurepassage)!==null&&providerInstant(row.last_update_fme)!==null)counters.validTime++
    if(row.type==='E')counters.estimatedCode++
    else if(row.type==='T')counters.theoreticalCode++
    else counters.otherCode++
    if(samples.length<8){const ds=destinationStop.get(row.idtarretdestination),last=t&&tripFinal.get(t.id);samples.push({lineCode:row.ligne,stopId:row.id,destinationId:row.idtarretdestination,exactStop:Boolean(s),commercialCode:Boolean(c),exactTrip:Boolean(t),exactTripStop:Boolean(b),destinationStopExists:Boolean(ds),destinationStopType:ds?.location_type??null,destinationParentId:ds?.parent_id??null,destinationName:ds?.name??null,tripFinalStopId:last?.id??null,tripFinalParentId:last?.parent_id??null,tripFinalName:last?.name??null,direction:row.direction,tripHeadsign:t?.headsign??null,type:row.type,passageTime:row.heurepassage,updatedAt:row.last_update_fme})}
   }
   report.matches={...counters,lineCodes:[...lineCodes].sort(),oldestUpdate:updates.length?new Date(Math.min(...updates)).toISOString():null,newestUpdate:updates.length?new Date(Math.max(...updates)).toISOString():null,samples}
  }finally{db.close()}
  if(payload.values.length===20&&Number(payload.nb_results)>20)report.limits.push('Page de 20 résultats seulement ; couverture complète non mesurée.')
 }
}catch(error){report.limits.push(error instanceof Error?error.name:'Erreur de consultation')}
const output=resolve(`.data/realtime-official-audit-${Date.now()}.json`);await mkdir(resolve('.data'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({...report,report:output}))
