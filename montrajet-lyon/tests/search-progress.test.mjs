import test from 'node:test'
import assert from 'node:assert/strict'
import { createSharedSearch } from '../server/search/shared.ts'
import { searchStream } from '../server/search/stream.ts'
import { readSearchResponse } from '../src/services/searchStream.ts'
import { createIgnProvider } from '../server/mobility/provider.ts'
import { createMobilityPlanner } from '../server/mobility/planner.ts'
import { createMobilityApi } from '../server/mobility/api.ts'
import { routingDatabase } from './helpers/journeys.mjs'

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
const a={latitude:45,longitude:4},b={latitude:45,longitude:4.001}
const pedestrian={profile:'pedestrian',resource:'bdtopo-osrm',crs:'EPSG:4326',timeUnit:'second',distanceUnit:'meter',duration:180,distance:201,geometry:{type:'LineString',coordinates:[[4,45],[4.001,45]]}}
const address={kind:'address',id:'address:TEST',name:'TEST 1 rue TEST',...a,precision:'housenumber',source:'BAN via IGN'}
const query={from:address,to:{kind:'stop',id:'D'},at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:120,walkingTransfers:false,maxTransfers:2}
const path={source:'IGN BD TOPO',profile:'pedestrian',resourceVersion:'TEST',fetchedAt:new Date().toISOString(),durationSeconds:180,distanceMeters:201,startSnapMeters:0,endSnapMeters:0,geometry:pedestrian.geometry}

test('Annuler un flux coupe immédiatement le travail sous-jacent, sans attendre sa fin',async()=>{
  let aborted=false
  const response=searchStream(new Request('http://localhost'),async(signal,progress)=>{
    progress({stage:'walking',at:new Date().toISOString()})
    await new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve()},{once:true}))
    return Response.json({status:'connected',data:[]})
  })
  const reader=response.body.getReader();await reader.read();await reader.cancel();assert.equal(aborted,true)
})

test('IGN : annuler un consommateur partagé préserve l’autre et son cache',async()=>{
  const end=deferred(),started=deferred();let signal,calls=0
  const provider=createIgnProvider(async(_url,options)=>{calls++;signal=options.signal;started.resolve();await end.promise;return Response.json(pedestrian)})
  const first=new AbortController(),second=new AbortController()
  const p=provider.walk(a,b,undefined,first.signal),rejection=assert.rejects(p)
  const other=provider.walk(a,b,undefined,second.signal)
  await started.promise;first.abort();await rejection;assert.equal(signal.aborted,false)
  end.resolve();assert.equal((await other).durationSeconds,180);await provider.walk(a,b);assert.equal(calls,1)
})

test('IGN : dernier consommateur annulé interrompt fetch ; requête annulée en file sans appel HTTP',async()=>{
  const started=deferred();let signal,calls=0
  const provider=createIgnProvider(async(_url,options)=>{
    calls++;signal=options.signal;started.resolve()
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))
  })
  const controller=new AbortController(),pending=provider.walk(a,b,undefined,controller.signal),rejection=assert.rejects(pending)
  await started.promise;controller.abort();await rejection;assert.equal(signal.aborted,true)
  const queued=new AbortController(),p=provider.walk(a,{...b,longitude:4.002},undefined,queued.signal),r=assert.rejects(p)
  queued.abort();await r;await new Promise(resolve=>setTimeout(resolve,300));assert.equal(calls,1)
})

test('Étapes réellement exécutées dans l’ordre ; date hors GTFS sans géocodage ni marche',async()=>{
  const f=await routingDatabase();try{
    f.trip('TEST','BUS',[['O',40000],['D',41000]])
    const stages=[];let geocodes=0,walks=0
    const provider={addresses:async()=>{geocodes++;assert.equal(stages.at(-1),'addresses');return [address]},walk:async()=>{walks++;assert.equal(stages.at(-1),'walking');return path}}
    const planner=createMobilityPlanner(f.db,provider)
    const result=await planner.search(query,undefined,event=>stages.push(event.stage))
    assert.ok(result.itineraries.length);assert.deepEqual(stages,['addresses','stops','walking','connections','ranking']);assert.ok(walks>0)
    const before={geocodes,walks};stages.length=0
    assert.equal((await planner.search({...query,at:'2028-01-01T10:00:00Z'},undefined,event=>stages.push(event.stage))).state,'outside_validity')
    assert.deepEqual({geocodes,walks},before);assert.deepEqual(stages,[])
  }finally{f.close()}
})

test('API mobilité : deux flux identiques partagent la résolution et les parcours, résultat JSON conservé',async()=>{
  const f=await routingDatabase();try{
    f.trip('TEST','BUS',[['O',40000],['D',41000]])
    let geocodes=0,walks=0;const gate=deferred()
    const api=createMobilityApi({addresses:async()=>{geocodes++;await gate.promise;return [address]},walk:async()=>{walks++;return path}})
    const request=()=>new Request('http://localhost/api/mobility/search',{method:'POST',headers:{Accept:'application/x-ndjson'},body:JSON.stringify(query)})
    const response1=await api(request(),f.db),response2=await api(request(),f.db)
    const stages1=[],stages2=[],p1=readSearchResponse(response1,undefined,e=>stages1.push(e.stage)),p2=readSearchResponse(response2,undefined,e=>stages2.push(e.stage))
    await new Promise(resolve=>setTimeout(resolve,20));gate.resolve()
    const [r1,r2]=await Promise.all([p1,p2]);assert.equal(r1.status,'connected');assert.deepEqual(r1,r2);assert.equal(geocodes,1);assert.ok(walks>0)
    assert.deepEqual(stages1,stages2)
    const json=await api(new Request('http://localhost/api/mobility/search',{method:'POST',body:JSON.stringify(query)}),f.db)
    assert.equal((await json.json()).status,'connected')
  }finally{f.close()}
})
test('Deux clients identiques partagent un calcul ; annuler un client ne coupe pas l’autre',async()=>{
  const shared=createSharedSearch(),end=deferred(),a=new AbortController(),b=new AbortController();let calls=0,underlying
  const work=async(signal,progress)=>{calls++;underlying=signal;progress({stage:'walking',at:new Date().toISOString()});return end.promise}
  const stages=[]
  const first=shared.run('same',work,a.signal),second=shared.run('same',work,b.signal,event=>stages.push(event.stage))
  const rejection=assert.rejects(first);await Promise.resolve();a.abort();await rejection
  assert.equal(calls,1);assert.equal(underlying.aborted,false);assert.deepEqual(stages,['walking'])
  end.resolve('GTFS');assert.equal(await second,'GTFS')
})
test('Annuler le dernier client annule le calcul ; un nouveau départ identique fonctionne',async()=>{
  const shared=createSharedSearch(),a=new AbortController();let underlying
  const first=shared.run('same',async signal=>{underlying=signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))},a.signal)
  const rejection=assert.rejects(first);await Promise.resolve();a.abort();await rejection;assert.equal(underlying.aborted,true)
  assert.equal(await shared.run('same',async()=>42,new AbortController().signal),42)
})
test('Flux : étapes reçues avant le résultat, contenu final identique au contrat JSON',async()=>{
  const end=deferred(),events=[]
  const response=searchStream(new Request('http://localhost'),async(signal,progress)=>{progress({stage:'walking',at:new Date().toISOString()});await end.promise;return Response.json({status:'connected',data:{real:'TEST'}})})
  const pending=readSearchResponse(response,undefined,event=>{events.push(event.stage);end.resolve()})
  assert.deepEqual(await pending,{status:'connected',data:{real:'TEST'}});assert.deepEqual(events,['walking'])
})
test('Flux UTF-8 fragmenté, erreurs IGN explicites, JSON historique et fin incomplète',async()=>{
  const source=JSON.stringify({type:'error',message:'IGN indisponible : accès non confirmé'})+'\n',bytes=new TextEncoder().encode(source)
  const response=new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close()}}),{headers:{'Content-Type':'application/x-ndjson'}})
  assert.equal((await readSearchResponse(response)).message,'IGN indisponible : accès non confirmé')
  assert.equal((await readSearchResponse(Response.json({error:'IGN HTTP 503'},{status:503}))).message,'IGN HTTP 503')
  await assert.rejects(()=>readSearchResponse(new Response('{"type":"stage","stage":"walking","at":"now"}\n',{headers:{'Content-Type':'application/x-ndjson'}})),/incomplet/)
})
