import type {AddressPlace,MobilityQuery,PlaceReference} from '../../src/types/mobility.ts'
import {emptyFavoriteStore,savePlace,saveTrip,resolveEndpoint,favoriteDraft} from '../../src/services/favorites.ts'
import {favoriteSchedule} from '../../src/services/favoriteJourney.ts'
export interface MobilityScenario {id:string;label:string;query:MobilityQuery;favorite?:boolean}
/** Exercise the real favorite model without touching the user's saved places. */
export function mobilityScenarios(home:AddressPlace,work:AddressPlace):MobilityScenario[]{
 let store=emptyFavoriteStore();store=savePlace(store,{name:'Domicile de référence QA',role:'home',location:home});store=savePlace(store,{name:'Travail de référence QA',role:'work',location:work})
 const h=store.places.find(p=>p.role==='home')!,w=store.places.find(p=>p.role==='work')!,stop={kind:'stop' as const,id:'35660',name:'Dauphiné-Lacassagne'}
 store=saveTrip(store,{name:'Favori mixte QA',from:{placeId:h.id},to:{location:{kind:'stop',id:'35668',name:'Vaulx-en-Velin La Soie'}},preferences:{mode:'departure',marginSeconds:180,maxTransfers:2,walkingTransfers:true}})
 const custom=store.trips[0],from=resolveEndpoint(store,custom.from)!,to=resolveEndpoint(store,custom.to)!
 favoriteDraft(from,to)
 const ref=(p:typeof from):PlaceReference=>{if(p.kind==='unresolved')throw new Error('Lieu favori non résolu');return p.kind==='stop'?{kind:'stop',id:p.id}:{kind:'address',id:p.id,name:p.name,expectedCoordinates:{latitude:p.latitude,longitude:p.longitude}}}
 const schedule=favoriteSchedule('2026-11-09T11:00',{mode:'departure'},custom.preferences)
 const query=(a:PlaceReference,b:PlaceReference,marginSeconds=120):MobilityQuery=>({from:a,to:b,at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds,walkingTransfers:true,maxTransfers:2})
 const H=ref(home),W=ref(work),S=ref(stop),D:PlaceReference={kind:'stop',id:'35668'}
 return[
  {id:'stop-stop',label:'Arrêt → arrêt',query:{...query(S,D),walkingTransfers:false}},
  {id:'address-address',label:'Adresse → adresse',query:query(H,W)},
  {id:'address-stop',label:'Adresse → arrêt',query:query(H,D)},
  {id:'stop-address',label:'Arrêt → adresse',query:query(S,W)},
  {id:'home-work',label:'Domicile → travail',favorite:true,query:query(ref(resolveEndpoint(store,{placeId:h.id})!),ref(resolveEndpoint(store,{placeId:w.id})!),180)},
  {id:'work-home',label:'Travail → domicile',favorite:true,query:query(W,H,180)},
  {id:'custom-favorite',label:'Favori personnalisé domicile → quai',favorite:true,query:query(ref(from),ref(to),schedule.preferences.marginSeconds!)},
 ]
}
