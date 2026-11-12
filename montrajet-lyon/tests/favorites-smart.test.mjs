import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { favoritesKey, emptyFavoriteStore, readFavoriteStore, writeFavoriteStore, clearFavoriteStore, parseFavoriteStore, parseLocation, parseFavoritePreferences, savedLocation, savePlace, saveTrip, removePlace, resolveEndpoint, favoriteDraft, favoriteEndpoint, readFavorites } from '../src/services/favorites.ts'
import { favoriteSchedule } from '../src/services/favoriteJourney.ts'
import { createMobilityPlanner } from '../server/mobility/planner.ts'
import { createMobilityApi } from '../server/mobility/api.ts'
import { routingDatabase } from './helpers/journeys.mjs'

// Synthetic fixtures are isolated in tests, never in local app data or the official GTFS.
const address=n=>({kind:'address',id:'address:TEST_'+n,name:'TEST '+n+' rue TEST',latitude:45,longitude:4+n*.001,precision:'housenumber',source:'BAN via IGN'})
const stop=n=>({kind:'stop',id:'TEST_'+n,name:'TEST arrêt homonyme',latitude:45,longitude:4})
let storage
beforeEach(()=>{
  storage=new Map()
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}})
})
function commute(){let s=emptyFavoriteStore();s=savePlace(s,{name:'TEST domicile',role:'home',location:address(1)});s=savePlace(s,{name:'TEST travail',role:'work',location:address(2)});return s}

test('Domicile et travail facultatifs, création et persistance dans une seule clé',()=>{
  assert.equal(readFavoriteStore().data.places.length,0)
  const s=commute(),saved=writeFavoriteStore(s);assert.equal(saved.error,'');assert.equal(storage.size,1);assert.equal(saved.data.version,2);assert.equal(saved.data.revision,1)
  assert.deepEqual(readFavoriteStore().data,saved.data);assert.ok(saved.data.places.every(p=>p.createdAt&&p.updatedAt))
})
test('Modification et remplacement conservent identifiant et création ; rôle principal unique',()=>{
  const s=commute(),p=s.places[0],edited=savePlace(s,{name:'TEST maison renommée',role:'home',location:address(3)},p.id)
  assert.equal(edited.places.find(x=>x.id===p.id).createdAt,p.createdAt);assert.equal(edited.places.find(x=>x.id===p.id).location.id,address(3).id)
  assert.throws(()=>savePlace(s,{name:'TEST doublon',role:'home',location:address(4)}),/existe déjà/)
  assert.throws(()=>savePlace(s,{name:'TEST alias involontaire',role:'other',location:address(1)}),/existe déjà/)
})
test('Trajets domicile/travail, inverse indépendant, références suivent une modification explicite',()=>{
  let s=commute();const [a,b]=s.places
  s=saveTrip(s,{name:'TEST aller',from:{placeId:a.id},to:{placeId:b.id},preferences:{mode:'arrival',arrivalTime:'08:30',maxTransfers:2,marginSeconds:120}})
  s=saveTrip(s,{name:'TEST retour',from:{placeId:b.id},to:{placeId:a.id},preferences:{mode:'departure',departureTime:'18:00'}})
  assert.equal(s.trips.length,2);assert.equal(resolveEndpoint(s,s.trips[1].from).id,address(2).id)
  s=savePlace(s,{name:'TEST nouveau travail',role:'work',location:address(3)},b.id)
  assert.equal(resolveEndpoint(s,s.trips[0].to).id,address(3).id)
  assert.equal('itineraries' in s.trips[0],false)
})
test('Suppression de lieu préserve explicitement une copie dans les trajets ; suppression totale ciblée',()=>{
  let s=commute();const [a,b]=s.places;s=saveTrip(s,{name:'TEST',from:{placeId:a.id},to:{placeId:b.id},preferences:{}})
  const next=removePlace(s,a.id);assert.equal(next.places.length,1);assert.equal(resolveEndpoint(next,next.trips[0].from).id,address(1).id)
  assert.ok('location' in next.trips[0].from)
  writeFavoriteStore(next);storage.set('OTHER_APPLICATION','TEST');assert.equal(clearFavoriteStore(),'');assert.equal(storage.has(favoritesKey),false);assert.equal(storage.get('OTHER_APPLICATION'),'TEST')
})
test('Quatre combinaisons adresse/arrêt, identifiants de quais et coordonnées conservés',()=>{
  for(const [from,to]of [[address(1),address(2)],[address(1),stop(2)],[stop(1),address(2)],[stop(1),stop(2)]]){
    const s=saveTrip(emptyFavoriteStore(),{name:'TEST',from:{location:from},to:{location:to},preferences:{maxTransfers:2}})
    assert.deepEqual(resolveEndpoint(s,s.trips[0].from),from);assert.deepEqual(resolveEndpoint(s,s.trips[0].to),to)
    const draft=favoriteDraft(from,to);assert.equal(draft.departure,from.name);assert.equal(draft.arrival,to.name)
    if(from.kind==='stop')assert.equal(draft.departureStopId,from.id);else assert.deepEqual(draft.departureAddress,from)
  }
})
test('Doublons de trajets : mêmes références/préférences refusées, nom ou inversion ne fusionnent pas les quais',()=>{
  let s=saveTrip(emptyFavoriteStore(),{name:'TEST',from:{location:stop(1)},to:{location:stop(2)},preferences:{marginSeconds:120,maxTransfers:2}})
  assert.throws(()=>saveTrip(s,{name:'TEST autre nom',from:{location:stop(1)},to:{location:stop(2)},preferences:{maxTransfers:2,marginSeconds:120}}),/existe déjà/)
  s=saveTrip(s,{name:'TEST inverse',from:{location:stop(2)},to:{location:stop(1)},preferences:{marginSeconds:120,maxTransfers:2}});assert.equal(s.trips.length,2)
  assert.throws(()=>saveTrip(s,{name:'TEST même lieu',from:{location:stop(1)},to:{location:stop(1)},preferences:{}}),/distincts/)
})
test('Migration v1 sans écriture à la lecture, références exactes et anciens noms sans ID conservés non résolus',()=>{
  const legacy=[{id:'legacy1',departure:'TEST O',arrival:'TEST D',departureStopId:'O',arrivalStopId:'D'},{id:'legacy2',departure:'TEST texte libre',arrival:'TEST D'}],raw=JSON.stringify(legacy)
  storage.set(favoritesKey,raw);const loaded=readFavoriteStore();assert.equal(loaded.migrated,true);assert.equal(storage.get(favoritesKey),raw);assert.equal(loaded.data.trips[0].id,'legacy1');assert.equal(loaded.data.trips[0].from.location.id,'O');assert.equal(loaded.data.trips[1].from.location.kind,'unresolved')
  assert.equal(writeFavoriteStore(loaded.data).error,'');assert.equal(JSON.parse(storage.get(favoritesKey)).version,2);assert.deepEqual(readFavorites().items,legacy)
})
test('Données corrompues ou version future : pas d’écrasement ; effacement explicite possible',()=>{
  for(const raw of ['{','{"version":99}','[null]']){
    storage.set(favoritesKey,raw);assert.ok(readFavoriteStore().error);assert.ok(writeFavoriteStore(emptyFavoriteStore()).error);assert.equal(storage.get(favoritesKey),raw)
  }
  assert.equal(clearFavoriteStore(),'');assert.equal(readFavoriteStore().error,'')
})
test('Stockage saturé ou refusé : sauvegarde échoue sans remplacer les favoris en mémoire',()=>{
  const s=commute();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:()=>null,setItem:()=>{throw new Error('TEST quota')},removeItem:()=>{throw new Error('TEST denied')}}})
  assert.ok(writeFavoriteStore(s).error);assert.equal(s.places.length,2);assert.ok(clearFavoriteStore())
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw new Error('TEST storage denied')}});assert.ok(readFavoriteStore().error)
})
test('Concurrence entre onglets détectée par révision, sans écrasement silencieux',()=>{
  const s=commute();assert.equal(writeFavoriteStore(s).error,'');const raw=storage.get(favoritesKey);assert.ok(writeFavoriteStore(s).error);assert.equal(storage.get(favoritesKey),raw)
})
test('Validation : adresse sans numéro, coordonnées invalides, préférences et références incohérentes refusées',()=>{
  for(const a of [{...address(1),latitude:NaN},{...address(1),longitude:181},{...address(1),precision:'street'},{...address(1),id:'wrong'}])assert.throws(()=>parseLocation(a))
  for(const p of [{mode:'now'},{departureTime:'24:00'},{arrivalTime:'03:60'},{marginSeconds:29},{maxTransfers:3},{walkingTransfers:'yes'}])assert.throws(()=>parseFavoritePreferences(p))
  const s=commute();assert.throws(()=>parseFavoriteStore({...s,trips:[{id:'bad',name:'TEST',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),from:{placeId:'MISSING'},to:{placeId:s.places[0].id},preferences:{}}]}))
})
test('Préférences horaires : jour sélectionné conservé, aller/arrivée et heure facultative appliqués',()=>{
  assert.deepEqual(favoriteSchedule('2026-11-12T11:00',{mode:'departure'},{mode:'arrival',arrivalTime:'08:30'}),{dateTime:'2026-11-12T08:30',preferences:{mode:'arrival',arrivalTime:'08:30'}})
  assert.equal(favoriteSchedule('2026-11-12T11:00',{mode:'departure'},{departureTime:'07:30'}).dateTime,'2026-11-12T07:30')
  assert.equal(favoriteSchedule('2026-11-12T11:00',{mode:'arrival'},{}).dateTime,'2026-11-12T11:00')
})
test('Affichage/migration/sauvegarde de favoris ne déclenchent aucun fetch ou géocodage',()=>{
  const old=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw new Error('TEST no network')}
  try{const s=commute();writeFavoriteStore(s);readFavoriteStore();favoriteDraft(s.places[0].location,s.places[1].location);assert.equal(calls,0)}finally{globalThis.fetch=old}
})
test('Adresse sélectionnée : seul le modèle minimal est sauvegardé, aucune réponse d’itinéraire ou secret',()=>{
  assert.deepEqual(savedLocation({...address(1),secret:'TEST',itineraries:['TEST']}),address(1))
  const p={id:'O',name:'TEST',latitude:null,longitude:null,platform:'TEST',parentId:'P',code:'TEST',lines:[{id:'TEST',name:'TEST'}]};assert.deepEqual(savedLocation(p),{kind:'stop',id:'O',name:'TEST'})
})
test('Enregistrement depuis le formulaire : lien vers le lieu exact existant, jamais vers un simple homonyme',()=>{
  const s=commute();assert.deepEqual(favoriteEndpoint(s,address(1)),{placeId:s.places[0].id})
  assert.ok('location' in favoriteEndpoint(s,{...address(1),latitude:45.01}))
  assert.ok('location' in favoriteEndpoint(s,{...stop(1),name:s.places[0].location.name}))
})
test('Migration et doublons : préférences par défaut implicites et explicites décrivent le même trajet',()=>{
  storage.set(favoritesKey,JSON.stringify([{id:'legacy',departure:'TEST O',arrival:'TEST D',departureStopId:'O',arrivalStopId:'D'}]))
  const s=readFavoriteStore().data
  assert.throws(()=>saveTrip(s,{name:'TEST copie',from:{location:{kind:'stop',id:'O',name:'TEST O'}},to:{location:{kind:'stop',id:'D',name:'TEST D'}},preferences:{mode:'departure',maxTransfers:2,marginSeconds:120,walkingTransfers:false,order:'arrival'}}),/existe déjà/)
})
test('Backend : changement de coordonnées BAN bloque le calcul, aucune marche inventée',async()=>{
  const f=await routingDatabase();try{
    f.trip('TEST','BUS',[['O',40000],['D',41000]]);let walks=0
    const a={...address(1),longitude:4},provider={addresses:async()=>[a],walk:async()=>{walks++;throw new Error('TEST should not route')}}
    await assert.rejects(()=>createMobilityPlanner(f.db,provider).search({from:{kind:'address',id:a.id,name:a.name,expectedCoordinates:{latitude:45,longitude:4.1}},to:{kind:'stop',id:'D'},at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:120,maxTransfers:2,walkingTransfers:false}),/coordonnées.*changé/)
    assert.equal(walks,0)
    const api=createMobilityApi(provider),request=new Request('http://local/api/mobility/search',{method:'POST',body:JSON.stringify({from:{kind:'address',id:a.id,name:a.name,expectedCoordinates:{latitude:null,longitude:4}},to:{kind:'stop',id:'D'},at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:120,maxTransfers:2,walkingTransfers:false})})
    assert.equal((await api(request,f.db)).status,400)
  }finally{f.close()}
})
