import type { RideLeg, TheoreticalJourney } from '../../../src/types/journey.ts'

const dayParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'})
const clockParts=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
const dateLabel=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'numeric',month:'short'})
const offset=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',timeZoneName:'shortOffset'})

export function localDay(instant:string){const parts=Object.fromEntries(dayParts.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}`}
export function shortClock(instant:string){const parts=Object.fromEntries(clockParts.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));return `${parts.hour}h${parts.minute}`}
export function clockDate(instant:string){return dateLabel.format(new Date(instant))}
export function offsetLabel(instant:string){return offset.formatToParts(new Date(instant)).find(p=>p.type==='timeZoneName')?.value||'Europe/Paris'}
export function duration(seconds:number){const total=Math.round(seconds),minutes=Math.floor(total/60),rest=total%60;return `${minutes} min${rest?` ${rest} s`:''}`}
export function modeLabel(type:number){return ({0:'Tramway',1:'Métro',2:'Train',3:'Bus',7:'Funiculaire',11:'Trolleybus',12:'Monorail',700:'Bus',701:'Bus régional',702:'Bus express',703:'Bus',704:'Bus local',705:'Bus de nuit',711:'Navette bus',712:'Bus scolaire',713:'Bus scolaire et public',714:'Bus de substitution',715:'Bus à la demande',716:'Bus',800:'Trolleybus',900:'Tramway',1400:'Funiculaire'} as Record<number,string>)[type]||`Transport GTFS ${type}`}
export function connections(journey:TheoreticalJourney){return journey.connections??(journey.connection?[journey.connection]:[])}
export function walkingSummary(journey:TheoreticalJourney){const links=connections(journey);return{known:links.reduce((sum,link)=>sum+(link.walkingSeconds??0),0),unknown:links.some(link=>link.walkingSeconds===null)}}
export function legDuration(leg:RideLeg){return (Date.parse(leg.arrivalTime)-Date.parse(leg.departureTime))/1000}
export function crossesClockChange(a:string,b:string){return offsetLabel(a)!==offsetLabel(b)}
