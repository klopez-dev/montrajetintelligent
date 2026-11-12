import test from 'node:test'
import assert from 'node:assert/strict'
import {routingDatabase} from './helpers/journeys.mjs'
import {compileCatalog,compileDay} from '../scripts/prototype/compile.mjs'
import {StaticDatabase} from '../experiments/hybrid/database.ts'
import {StaticConsultation} from '../experiments/preproduction/data.ts'
import {getPassages,getDirections} from '../server/gtfs/repository.ts'
import {validateSearch} from '../experiments/preproduction/validation.ts'
import {parseVersionPointer} from '../experiments/preproduction/version.ts'

test('Préproduction : pointeur strict, versions incompatibles et champs absents refusés',()=>{
 const encode=v=>new TextEncoder().encode(JSON.stringify(v)),valid={schema:2,manifestSha256:'a'.repeat(64),feedSha256:'b'.repeat(64)}
 assert.deepEqual(parseVersionPointer(encode(valid)),valid)
 for(const value of [null,{},[],{...valid,schema:99},{...valid,feedSha256:null},{...valid,manifestSha256:'../manifest.json'}])assert.throws(()=>parseVersionPointer(encode(value)),/incompatible/)
 assert.throws(()=>parseVersionPointer(new TextEncoder().encode('{')),/illisible/)
})
test('Préproduction : horaires identiques à SQLite, dates et heures après minuit',async()=>{
 const f=await routingDatabase();try{f.trip('A','BUS',[['O',39600],['D',40200]]);f.trip('NIGHT','BUS',[['O',87000],['D',87600]]);const catalog=compileCatalog(f.sqlite),db=new StaticDatabase(catalog,async date=>new Uint8Array(compileDay(f.sqlite,catalog,date)).buffer),data=new StaticConsultation(db,async()=>({tripDates:{},directions:[]}));for(const at of ['2026-11-09T10:00:00Z','2026-11-09T23:05:00Z','2028-01-01T00:00:00Z'])assert.deepEqual(await data.passages('BUS','O',Date.parse(at)),await getPassages(f.db,'BUS','O',Date.parse(at)))}finally{f.close()}
})
test('Préproduction : direction et cartes conservent courses et séquences, jamais de tracé inventé',async()=>{
 const f=await routingDatabase();try{f.trip('A','BUS',[['O',39600],['X',39900],['D',40200]],'DAILY',{direction:'1'});const catalog=compileCatalog(f.sqlite),db=new StaticDatabase(catalog,async date=>new Uint8Array(compileDay(f.sqlite,catalog,date)).buffer),directions=[{stopId:'O',lineId:'BUS',id:'1',headsign:'TEST DESTINATION'}],data=new StaticConsultation(db,async()=>({tripDates:{A:'2026-11-09'},directions}));assert.deepEqual(await data.directions('BUS','O'),JSON.parse(JSON.stringify(await getDirections(f.db,'BUS','O'))));const body={feedSha256:'TEST',legs:[{tripId:'A',fromSequence:1,toSequence:3,fromStopId:'O',toStopId:'D'}]},map=await data.map(body);assert.deepEqual(map.legs[0].stops.map(s=>s.id),['O','X','D']);assert.equal(map.legs[0].geometry,null);await assert.rejects(()=>data.map({...body,feedSha256:'WRONG'}),/incompatible/);await assert.rejects(()=>data.map({...body,legs:[{...body.legs[0],toStopId:'X'}]}),/invalides/)}finally{f.close()}
})
test('Préproduction : entrées invalides refusées avant les fournisseurs',()=>{
 const q={fromStopId:'O',toStopId:'D',at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:120,maxTransfers:2};assert.doesNotThrow(()=>validateSearch(q));for(const change of [{mode:'invented'},{at:'2026-02-30T10:00:00Z'},{toStopId:'O'},{maxTransfers:3},{order:'invented'}])assert.throws(()=>validateSearch({...q,...change}));assert.throws(()=>validateSearch({...q,from:{kind:'address',id:'A',name:'TEST',expectedCoordinates:{latitude:1000,longitude:4}},to:{kind:'stop',id:'D'},walkingTransfers:true}))
})
