import type { Coordinate, MapStep, TransitMapResponse } from '../types/journeyMap.ts'
import type { TheoreticalJourney } from '../types/journey.ts'
import type { DoorJourney, WalkPath } from '../types/mobility.ts'

export function coordinate(value: unknown): value is Coordinate {
  return Array.isArray(value) && value.length === 2 && value.every(n => typeof n === 'number' && Number.isFinite(n)) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90
}
export function lineGeometry(value: unknown): MapStep['geometry'] {
  const g = value as MapStep['geometry']
  return g?.type === 'LineString' && Array.isArray(g.coordinates) && g.coordinates.length >= 2 && g.coordinates.length <= 20000 && g.coordinates.every(coordinate) ? { type: 'LineString', coordinates: g.coordinates } : null
}
/** Future shapes require explicit, ordered source distances. Never snap a loop by proximity. */
export function sliceMeasuredShape(points: { coordinate: Coordinate; distance: number }[], from: number, to: number): MapStep['geometry'] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || points.length < 2 || points.some((p,i) => !coordinate(p.coordinate) || !Number.isFinite(p.distance) || (i > 0 && p.distance <= points[i-1].distance))) return null
  const a=points.findIndex(p=>p.distance===from), b=points.findIndex(p=>p.distance===to)
  return a >= 0 && b > a ? lineGeometry({type:'LineString',coordinates:points.slice(a,b+1).map(p=>p.coordinate)}) : null
}
const time=(s:string)=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}).format(new Date(s))
export function mapSteps(journey: TheoreticalJourney, data: TransitMapResponse, door?: DoorJourney): MapStep[] {
  if(data.legs.length!==journey.legs.length)throw new Error('Nombre de portions cartographiques incohérent.')
  const steps:MapStep[]=[]
  const walk=(path:WalkPath,title:string,description:string)=>{
    const geometry=lineGeometry(path.geometry)
    steps.push({id:`step-${steps.length}`,kind:'walk',title,description:`${description} · ${Math.round(path.distanceMeters)} m · ${Math.ceil(path.durationSeconds/60)} min estimées. Raccordements au réseau non décrits.`,points:geometry?[{coordinate:geometry.coordinates[0],label:'Début du parcours piéton'},{coordinate:geometry.coordinates.at(-1)!,label:'Fin du parcours piéton'}]:[],geometry,color:'#18766d',geometrySource:geometry?`${path.source} · EPSG:4326`:'Géométrie piétonne indisponible'})
  }
  if(door?.access)walk(door.access,'Marche initiale',`${door.fromName} → ${journey.legs[0].from.name}`)
  journey.legs.forEach((leg,i)=>{
    const source=data.legs[i]
    if(source.tripId!==leg.tripId || source.stops[0]?.sequence!==leg.from.sequence || source.stops.at(-1)?.sequence!==leg.to.sequence || source.stops[0]?.id!==leg.from.id || source.stops.at(-1)?.id!==leg.to.id)throw new Error('Course ou ordre des quais incohérent.')
    const points=source.stops.flatMap(s=>coordinate([s.longitude,s.latitude])?[{coordinate:[s.longitude!,s.latitude!] as Coordinate,label:`${s.name} · quai ${s.id} · séquence ${s.sequence}`}]:[])
    steps.push({id:`step-${steps.length}`,kind:'ride',title:`${leg.lineName} · ${mapMode(leg.routeType)}`,description:`Direction ${leg.headsign || 'non renseignée'} · ${leg.from.name} → ${leg.to.name} · ${time(leg.departureTime)} → ${time(leg.arrivalTime)} · ${Math.round((Date.parse(leg.arrivalTime)-Date.parse(leg.departureTime))/60000)} min · horaire théorique`,points,geometry:null,color:source.color || '#304763',geometrySource:source.color?'Arrêts GTFS · couleur officielle · tracé indisponible':'Arrêts GTFS · couleur de remplacement · tracé indisponible'})
    const transfer=journey.connections?.[i] ?? (i===0?journey.connection:null)
    if(i<journey.legs.length-1 && transfer){
      if(transfer.walkingPath)walk(transfer.walkingPath,'Correspondance à pied',`${transfer.fromStopName} → ${transfer.toStopName}`)
      else steps.push({id:`step-${steps.length}`,kind:'transfer',title:'Correspondance',description:`${transfer.fromStopName} → ${transfer.toStopName} · minimum ${Math.ceil(transfer.requiredSeconds/60)} min, marge incluse · intervalle ${Math.floor(transfer.intervalSeconds/60)} min`,points:[...(points.at(-1)?[points.at(-1)!]:[])],geometry:null,color:'#304763',geometrySource:'Trajet piéton non décrit par la source ; aucun lien dessiné'})
    }
  })
  if(door?.egress)walk(door.egress,'Marche finale',`${journey.legs.at(-1)!.to.name} → ${door.toName}`)
  return steps
}
export function mapMode(type:number):string {return ({0:'Tramway',1:'Métro',2:'Train',3:'Bus',7:'Funiculaire',11:'Trolleybus',700:'Bus',800:'Trolleybus',900:'Tramway',1400:'Funiculaire'} as Record<number,string>)[type] || `Transport GTFS ${type}`}
