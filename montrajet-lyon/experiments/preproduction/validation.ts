import {parseGtfsDate} from '../../server/gtfs/time.ts'
export function validateSearch(value:unknown){
 const q=value as Record<string,unknown>,id=(s:unknown)=>typeof s==='string'&&s.length>0&&s.length<=160
 if(!q||typeof q!=='object'||!['departure','arrival'].includes(String(q.mode))||!Number.isInteger(q.marginSeconds)||Number(q.marginSeconds)<0||Number(q.marginSeconds)>1800||![1,2].includes(Number(q.maxTransfers??2))||typeof q.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(q.at)||!Number.isFinite(Date.parse(q.at)))throw new Error('Paramètres de recherche invalides')
 parseGtfsDate(q.at.slice(0,10).replaceAll('-',''))
 if('from'in q){
  const place=(v:unknown)=>{const p=v as Record<string,unknown>;if(!p||!id(p.id)||!['stop','address'].includes(String(p.kind)))return false;if(p.kind==='stop')return true;if(typeof p.name!=='string'||p.name.length<3||p.name.length>160)return false;if(p.expectedCoordinates!==undefined){const point=p.expectedCoordinates as {latitude:number;longitude:number};if(!point||!Number.isFinite(point.latitude)||Math.abs(point.latitude)>90||!Number.isFinite(point.longitude)||Math.abs(point.longitude)>180)return false}return true}
  if(!place(q.from)||!place(q.to)||typeof q.walkingTransfers!=='boolean'||!['arrival','departure','duration','transfers','walking','waiting'].includes(String(q.order)))throw new Error('Sélectionnez deux lieux explicites et des préférences valides')
 }else if(!id(q.fromStopId)||!id(q.toStopId)||q.fromStopId===q.toStopId||!['arrival','departure','duration','transfers'].includes(String(q.order)))throw new Error('Sélectionnez deux quais distincts et un classement valide')
}
