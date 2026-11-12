import type { QueryDatabase } from '../gtfs/repository.ts'
import { getMetadata } from '../gtfs/repository.ts'
import type { MapLegReference, MapStop, TransitMapLeg } from '../../src/types/journeyMap.ts'
export interface MapCatalog { sha256: string; colors: Record<string,string>; shapesAvailable: boolean }
export async function handleMapRequest(request:Request,db:QueryDatabase|null,catalog?:MapCatalog|null):Promise<Response>{
  const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
  if(request.method!=='POST')return json({error:'Méthode non autorisée.'},405)
  if(!db)return json({error:'Base GTFS indisponible.'},503)
  try{
    const raw=await request.text();if(raw.length>12000)return json({error:'Requête trop volumineuse.'},413)
    const body=JSON.parse(raw) as {legs:MapLegReference[];feedSha256:string}
    if(!Array.isArray(body.legs)||body.legs.length<1||body.legs.length>3||body.legs.some(l=>!l||[l.tripId,l.fromStopId,l.toStopId].some(s=>typeof s!=='string'||!s||s.length>200)||!Number.isSafeInteger(l.fromSequence)||!Number.isSafeInteger(l.toSequence)||l.fromSequence<0||l.toSequence<=l.fromSequence))return json({error:'Références de course invalides.'},400)
    const started=performance.now(),metadata=await getMetadata(db)
    if(body.feedSha256!==metadata.sha256)return json({error:'Le GTFS a changé. Recalculez le trajet.'},409)
    const legs:TransitMapLeg[]=[]
    for(const l of body.legs){
      const [trip]=await db.all<{routeId:string;lineName:string;routeType:number;headsign:string}>('SELECT t.route_id AS routeId, COALESCE(NULLIF(r.short_name,\'\'),r.long_name) AS lineName,r.type AS routeType,t.headsign FROM trips t JOIN routes r ON r.id=t.route_id WHERE t.id=?',[l.tripId])
      const stops=await db.all<MapStop>('SELECT s.id,s.name,st.sequence,s.latitude,s.longitude FROM stop_times st JOIN stops s ON s.id=st.stop_id WHERE st.trip_id=? AND st.sequence BETWEEN ? AND ? ORDER BY st.sequence LIMIT 401',[l.tripId,l.fromSequence,l.toSequence])
      if(!trip||stops.length<2||stops.length>400||stops[0].id!==l.fromStopId||stops[0].sequence!==l.fromSequence||stops.at(-1)!.id!==l.toStopId||stops.at(-1)!.sequence!==l.toSequence)return json({error:'Course, quais ou séquences introuvables. Recalculez le trajet.'},422)
      const color=catalog?.sha256===metadata.sha256?catalog.colors?.[trip.routeId]:null
      legs.push({...trip,tripId:l.tripId,stops,color:typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color)?color:null,geometry:null,geometryStatus:'unavailable'})
    }
    return json({feedSha256:metadata.sha256,legs,durationMs:performance.now()-started,warning:'Aucun tracé de transport disponible dans ce GTFS : seuls les arrêts sont représentés.'})
  }catch{return json({error:'Données cartographiques indisponibles ou requête illisible.'},400)}
}
