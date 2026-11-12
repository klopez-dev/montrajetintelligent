import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createMobilityPlanner} from '../../server/mobility/planner.ts'
import {createIgnProvider,GeographicError} from '../../server/mobility/provider.ts'
import {loadStaticDatabase} from '../../experiments/hybrid/load.ts'
import {emptyFavoriteStore,savePlace,resolveEndpoint,favoriteDraft} from '../../src/services/favorites.ts'
import {favoriteSchedule} from '../../src/services/favoriteJourney.ts'
import {auditJourney} from '../../tests/helpers/journeys.mjs'
import {cpuMs} from '../audit/metrics.mjs'

const directory=resolve(process.argv[2]||''),output=resolve(`.data/hybrid-mobility-${Date.now()}`);await mkdir(output)
const replayOnly=Boolean(process.argv[3]),sqlite=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),db={all:async(s,p=[])=>sqlite.prepare(s).all(...p)},manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8')),ign=createIgnProvider(),ledger=new Map(replayOnly?JSON.parse(await readFile(resolve(process.argv[3]),'utf8')):[]),report={cases:[],divergences:[],replayOnly,notes:['Public sample addresses only. IGN successes and failures recorded once then replayed without new network for the static comparison.','Replay never fabricates a positive walking response; missing recorded keys fail and are reported.']};let recording=!replayOnly,replayMisses=0
async function call(method,args,trace,signal){
 const key=JSON.stringify([method,args])
 if(!recording){const hit=ledger.get(key);if(!hit){replayMisses++;throw new GeographicError('Marche non enregistrée : comparaison refusée')}if(hit.error)throw new GeographicError(hit.error);return hit.value}
 try{const value=await ign[method](...args,trace,signal);ledger.set(key,{value});return value}catch(e){ledger.set(key,{error:e.message});throw e}
}
const provider={addresses:(q,t,s)=>call('addresses',[q],t,s),resolveAddress:(id,name,t,s)=>call('resolveAddress',[id,name],t,s),walk:(a,b,t,s)=>call('walk',[{latitude:a.latitude,longitude:a.longitude},{latitude:b.latitude,longitude:b.longitude}],t,s)}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>k!=='metrics').map(([k,v])=>[k,canonical(v)]));return value}
try{
 const home=(await provider.addresses('100 avenue Lacassagne Lyon')).find(a=>a.precision==='housenumber'&&a.name.startsWith('100 Avenue Lacassagne')),work=(await provider.addresses('5 avenue des Canuts Vaulx-en-Velin')).find(a=>a.precision==='housenumber'&&a.name.startsWith('5 Avenue des Canuts'))
 assert.ok(home&&work,'Official geocoding required, no substitute')
 let store=emptyFavoriteStore();store=savePlace(store,{role:'home',name:'QA home',location:home});store=savePlace(store,{role:'work',name:'QA work',location:work})
 const a=resolveEndpoint(store,{placeId:store.places.find(p=>p.role==='home').id}),b=resolveEndpoint(store,{placeId:store.places.find(p=>p.role==='work').id}),draft=favoriteDraft(a,b),schedule=favoriteSchedule('2026-11-09T11:00',{mode:'departure'},{mode:'departure',departureTime:'11:00',marginSeconds:180})
 assert.equal(draft.departureAddress.id,home.id);assert.equal(schedule.dateTime,'2026-11-09T11:00')
 const ref=p=>({kind:'address',id:p.id,name:p.name,expectedCoordinates:{latitude:p.latitude,longitude:p.longitude}})
 const cases=[['address-address',ref(home),ref(work),120],['address-stop',ref(home),{kind:'stop',id:'35668'},120],['commute-favorite',ref(a),ref(b),schedule.preferences.marginSeconds],['return-favorite',ref(b),ref(a),180]]
 for(const [name,from,to,marginSeconds]of cases){
   const query={from,to,marginSeconds,at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',walkingTransfers:true,maxTransfers:2},entry={name,implementations:[]};let reference
   for(const mode of ['sqlite','static']){
    recording=mode==='sqlite'&&!replayOnly;let compressedBytes=0
    const data=mode==='sqlite'?db:await loadStaticDatabase(manifest,async f=>{const b=await readFile(resolve(directory,f));compressedBytes+=b.length;return b}),planner=createMobilityPlanner(data,provider),cpu=process.cpuUsage(),at=performance.now(),result=await planner.search(query),wallMs=performance.now()-at,cpuUsed=cpuMs(process.cpuUsage(cpu))
    assert.ok(result.itineraries.length,'No real itinerary for '+name)
    for(const i of result.itineraries)auditJourney(sqlite,i.transitResult,i.transit)
    if(mode==='sqlite')reference=canonical(result)
    const equal=JSON.stringify(reference)===JSON.stringify(canonical(result));if(!equal)report.divergences.push({name,reference,actual:canonical(result)})
    entry.implementations.push({mode,wallMs,cpuMs:cpuUsed,compressedBytes,proposals:result.itineraries.length,state:result.state,metrics:result.metrics,equal})
   }
   report.cases.push(entry);console.log(name,JSON.stringify(entry.implementations))
 }
 report.replayMisses=replayMisses;report.recordedCalls=ledger.size;report.status=report.divergences.length||replayMisses?'divergent':'passed';if(report.status!=='passed')process.exitCode=1
}catch(e){report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1}
finally{sqlite.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});await writeFile(resolve(output,'official-replay.json'),JSON.stringify([...ledger]),{flag:'wx'});console.log(output)}
