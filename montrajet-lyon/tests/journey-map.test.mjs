import {test} from 'node:test'
import assert from 'node:assert/strict'
import {coordinate,lineGeometry,sliceMeasuredShape,mapSteps} from '../src/services/mapGeometry.ts'
import {mapProvider} from '../src/services/mapProvider.ts'
import {handleMapRequest} from '../server/maps/api.ts'
import {DatabaseSync} from 'node:sqlite'

test('Coordonnées GeoJSON longitude/latitude : nombres finis et bornes, jamais null ou chaînes',()=>{
  assert.equal(coordinate([4.8,45.7]),true)
  for(const p of [[null,45],[4,'45'],[NaN,0],[181,0],[0,-91],[1,2,3],{}])assert.equal(coordinate(p),false)
})
test('Marches : conserve les points WGS84, refuse autre géométrie ou points invalides',()=>{
  const g={type:'LineString',coordinates:[[4.8,45.7],[4.81,45.71]]}
  assert.deepEqual(lineGeometry(g),g)
  for(const p of [null,{type:'Point',coordinates:[4,45]},{type:'LineString',coordinates:[[4,45]]},{type:'LineString',coordinates:[[4,45],[null,45]]}])assert.equal(lineGeometry(p),null)
})
test('Formes mesurées : portion orientée, boucle et arrêts répétés sans rapprochement géographique',()=>{
  const p=[{coordinate:[4,45],distance:0},{coordinate:[5,45],distance:10},{coordinate:[4,45],distance:20},{coordinate:[4,46],distance:30}]
  assert.deepEqual(sliceMeasuredShape(p,20,30).coordinates,[[4,45],[4,46]])
  for(const pair of [[30,0],[0,11],[20,20]])assert.equal(sliceMeasuredShape(p,...pair),null)
  assert.equal(sliceMeasuredShape([...p].reverse(),0,30),null)
  assert.equal(sliceMeasuredShape([],0,30),null)
})
function fixture(){
  const leg={tripId:'TEST_trip',routeId:'TEST_route',lineName:'TEST',routeType:0,headsign:'TEST sens',from:{id:'TEST_A',name:'A',sequence:5},to:{id:'TEST_B',name:'B',sequence:9},departureTime:'2026-11-09T10:00:00Z',arrivalTime:'2026-11-09T10:10:00Z'}
  const journey={id:'TEST_journey',legs:[leg],connections:[]}
  const data={legs:[{tripId:leg.tripId,color:null,stops:[{...leg.from,longitude:4,latitude:45},{...leg.to,longitude:4.1,latitude:45.1}],geometry:null}]}
  return {journey,data}
}
test('Sans shapes : arrêts exacts seulement, aucun segment droit et couleur de remplacement explicite',()=>{
  const {journey,data}=fixture(),steps=mapSteps(journey,data)
  assert.equal(steps[0].geometry,null);assert.equal(steps[0].points.length,2)
  assert.match(steps[0].geometrySource,/remplacement/);assert.match(steps[0].title,/Tramway/)
  data.legs[0].color='#00ff00';assert.match(mapSteps(journey,data)[0].geometrySource,/officielle/)
})
test('Course et séquences doivent correspondre, même si les noms des quais se ressemblent',()=>{
  for(const mutate of [d=>d.legs[0].tripId='other',d=>d.legs[0].stops.reverse(),d=>d.legs[0].stops[0].id='TEST_homonyme']){
    const {journey,data}=fixture();mutate(data);assert.throws(()=>mapSteps(journey,data),/incohérent/)
  }
})
test('Marche sans géométrie : distance/durée conservées et absence de tracé signalée',()=>{
  const {journey,data}=fixture(),path={geometry:null,distanceMeters:80,durationSeconds:70}
  const steps=mapSteps(journey,data,{access:path,fromName:'TEST adresse'})
  assert.equal(steps[0].geometry,null);assert.match(steps[0].description,/80 m/);assert.match(steps[0].geometrySource,/indisponible/)
})
test('Vue du trajet courant remplace les étapes sans muter la proposition précédente ; aucun fetch IGN',()=>{
  const {journey,data}=fixture(),old=JSON.stringify(journey),one=mapSteps(journey,data)
  const next=structuredClone(journey);next.legs[0].headsign='TEST autre direction'
  const two=mapSteps(next,data);assert.notEqual(one[0].description,two[0].description);assert.equal(JSON.stringify(journey),old)
})
test('Fournisseur configurable : aucun URL arbitraire ni clé secrète',()=>{
  assert.equal(mapProvider('none'),'none');assert.equal(mapProvider(undefined),'osm');assert.equal(mapProvider('https://TEST.invalid'),'osm')
})
test('API cartographique réelle : exactitude des courses, sens, séquences, couleurs et refus GTFS différent',async()=>{
  const sqlite=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true})
  try{
    const db={all:async(sql,params=[])=>sqlite.prepare(sql).all(...params)}
    const metadata=JSON.parse(sqlite.prepare('SELECT json FROM metadata WHERE id=1').get().json)
    const trip=sqlite.prepare("SELECT t.id FROM trips t JOIN routes r ON r.id=t.route_id WHERE r.short_name='T3' LIMIT 1").get()
    const stops=sqlite.prepare('SELECT stop_id,sequence FROM stop_times WHERE trip_id=? ORDER BY sequence').all(trip.id)
    const first=stops[0],last=stops.at(-1),body={feedSha256:metadata.sha256,legs:[{tripId:trip.id,fromStopId:first.stop_id,toStopId:last.stop_id,fromSequence:first.sequence,toSequence:last.sequence}]}
    const request=b=>new Request('http://localhost/api/maps',{method:'POST',body:JSON.stringify(b)})
    const good=await handleMapRequest(request(body),db);assert.equal(good.status,200)
    const result=await good.json();assert.equal(result.legs[0].geometry,null);assert.deepEqual(result.legs[0].stops.map(s=>s.id),stops.map(s=>s.stop_id));assert.equal(result.legs[0].color,null)
    assert.equal((await handleMapRequest(request({...body,feedSha256:'TEST_changed'}),db)).status,409)
    assert.equal((await handleMapRequest(request({...body,legs:[{...body.legs[0],fromSequence:last.sequence,toSequence:first.sequence}]}),db)).status,400)
    assert.equal((await handleMapRequest(request({...body,legs:[{...body.legs[0],fromStopId:'TEST_wrong_platform'}]}),db)).status,422)
    assert.equal((await handleMapRequest(request({...body,legs:Array(4).fill(body.legs[0])}),db)).status,400)
    assert.equal((await handleMapRequest(request(body),null)).status,503)
    assert.equal((await handleMapRequest(new Request('http://localhost/api/maps'),db)).status,405)
  }finally{sqlite.close()}
})
