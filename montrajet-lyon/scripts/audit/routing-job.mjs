import {DatabaseSync} from 'node:sqlite'
import {writeFile} from 'node:fs/promises'
import {createJourneyPlanner} from '../../server/journeys/planner.ts'
import {createMobilityPlanner} from '../../server/mobility/planner.ts'
import {createIgnProvider} from '../../server/mobility/provider.ts'
import {getPassages} from '../../server/gtfs/repository.ts'
import {emptyFavoriteStore,savePlace,resolveEndpoint} from '../../src/services/favorites.ts'
import {auditJourney} from '../../tests/helpers/journeys.mjs'
import {cpuMs,intervalUnionMs} from './metrics.mjs'

const [kind,destination]=process.argv.slice(2)
if(!['direct','one','two','address-address','address-stop','commute','timetable'].includes(kind)||!destination)throw new Error('Invalid audit job')
const started=performance.now(),dbNative=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),openMs=performance.now()-started
let counters,peak={rss:0,heapUsed:0,external:0},intervals=[]
function memory(){const m=process.memoryUsage();for(const k of Object.keys(peak))peak[k]=Math.max(peak[k],m[k]);return m}
const database={all:async(sql,params=[])=>{
  const at=performance.now(),cpu=process.cpuUsage(),rows=dbNative.prepare(sql).all(...params)
  if(counters){counters.sqlMs+=performance.now()-at;counters.sqlCpuMs+=cpuMs(process.cpuUsage(cpu));counters.sqlQueries++;counters.returnedRows+=rows.length;counters.maxResultRows=Math.max(counters.maxResultRows,rows.length);counters.maxParameters=Math.max(counters.maxParameters,params.length);counters.maxParameterBytes=Math.max(counters.maxParameterBytes,...params.map(p=>typeof p==='string'?Buffer.byteLength(p):0))}
  memory();return rows
}}
const provider=createIgnProvider(async(...args)=>{
  const a=performance.now(),type=String(args[0]).includes('/geocodage/')?'geocoding':'walking'
  try{
    const response=await fetch(...args),text=response.text.bind(response)
    response.text=async()=>{try{return await text()}finally{intervals.push({a,b:performance.now(),type})}}
    if(!response.ok)intervals.push({a,b:performance.now(),type})
    return response
  }catch(e){intervals.push({a,b:performance.now(),type});throw e}
})
const journeyPlanner=createJourneyPlanner(database),mobilityPlanner=createMobilityPlanner(database,provider),samples=[]
const timer=setInterval(memory,10);memory()
try{
  for(let repetition=0;repetition<3;repetition++){
    counters={sqlMs:0,sqlCpuMs:0,sqlQueries:0,returnedRows:0,maxResultRows:0,maxParameters:0,maxParameterBytes:0};intervals=[]
    const before=memory(),cpu=process.cpuUsage(),at=performance.now()
    let result,geocodingSelectionMs=0
    const base={fromStopId:kind==='direct'?'35660':kind==='one'?'2397':'1138',toStopId:kind==='direct'?'35668':'36394',at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:120,maxTransfers:2}
    if(['direct','one','two'].includes(kind))result=await journeyPlanner.search(base)
    else if(kind==='timetable'){
      const line=dbNative.prepare("SELECT id FROM routes WHERE short_name='T3' LIMIT 1").get()
      result=await getPassages(database,line.id,'35660',Date.parse(base.at))
      if(!result.passages.length)throw new Error('Expected real T3 passages for timetable benchmark')
    }else{
      const selection=performance.now()
      // Public QA addresses, selected from real official BAN responses. No user profile.
      const home=(await provider.addresses('100 avenue Lacassagne Lyon')).find(a=>a.precision==='housenumber'&&a.name.startsWith('100 Avenue Lacassagne'))
      let work
      if(kind!=='address-stop')work=(await provider.addresses('5 avenue des Canuts Vaulx-en-Velin')).find(a=>a.precision==='housenumber'&&a.name.startsWith('5 Avenue des Canuts'))
      if(!home||(kind!=='address-stop'&&!work))throw new Error('Official geocoding unavailable; no fallback fixture')
      geocodingSelectionMs=performance.now()-selection
      let from={kind:'address',id:home.id,name:home.name},to=work?{kind:'address',id:work.id,name:work.name}:{kind:'stop',id:'35668'}
      if(kind==='commute'){
        let store=emptyFavoriteStore();store=savePlace(store,{role:'home',name:'QA home',location:home});store=savePlace(store,{role:'work',name:'QA work',location:work})
        const a=resolveEndpoint(store,{placeId:store.places.find(p=>p.role==='home').id}),b=resolveEndpoint(store,{placeId:store.places.find(p=>p.role==='work').id})
        from={kind:'address',id:a.id,name:a.name};to={kind:'address',id:b.id,name:b.name}
      }
      result=await mobilityPlanner.search({from,to,at:base.at,mode:base.mode,order:'arrival',marginSeconds:kind==='commute'?180:120,maxTransfers:2,walkingTransfers:true})
    }
    const computeWallMs=performance.now()-at,processCpuMs=cpuMs(process.cpuUsage(cpu)),networkWallMs=intervalUnionMs(intervals.map(v=>[v.a,v.b]))
    const serialStart=performance.now(),serialCpu=process.cpuUsage(),text=JSON.stringify(result),serialization={wallMs:performance.now()-serialStart,cpuMs:cpuMs(process.cpuUsage(serialCpu)),bytes:Buffer.byteLength(text)}
    // Audit outside measured calculation/serialization. Native reads do not warm planner caches.
    if(kind!=='timetable'){
      if(!result.itineraries.length)throw new Error('No real itinerary for audit case '+kind)
      for(const i of result.itineraries){const transit=i.transit||i;auditJourney(dbNative,i.transitResult||result,transit)}
      const expected={direct:0,one:1,two:2}[kind]
      if(expected!==undefined&&!result.itineraries.some(i=>i.transfers===expected))throw new Error('Expected transfer count absent')
    }
    samples.push({cache:repetition?'warm':'cold-process',repetition,state:result.state,computeWallMs,processCpuMs,sql:{...counters},nonSqlProcessCpuMs:Math.max(0,processCpuMs-counters.sqlCpuMs),network:{wallUnionMs:networkWallMs,geocodingWallUnionMs:intervalUnionMs(intervals.filter(v=>v.type==='geocoding').map(v=>[v.a,v.b])),walkingWallUnionMs:intervalUnionMs(intervals.filter(v=>v.type==='walking').map(v=>[v.a,v.b])),requests:intervals.length},geocodingSelectionMs,serialization,metrics:result.metrics,proposals:result.itineraries?.length,passages:result.passages?.length,beforeMemory:before,afterMemory:memory()})
  }
  const report={kind,openMs,samples,peakSampledMemory:peak,maxRssKiB:process.resourceUsage().maxRSS,status:'passed',notes:['CPU includes native SQLite; nonSqlProcessCpuMs subtracts measured synchronous SQL CPU, not a Workers measurement.','Network intervals include body read/decoding and overlap; union is not the sum of concurrent requests.','Memory samples are a lower bound on peaks; maxRSS includes Node/native SQLite. Cold process does not flush OS disk cache.']}
  await writeFile(destination,JSON.stringify(report,null,2),{flag:'wx'});console.log(kind,JSON.stringify(samples.map(s=>({cache:s.cache,wallMs:s.computeWallMs,cpuMs:s.processCpuMs,nonSqlCpuMs:s.nonSqlProcessCpuMs,rows:s.sql.returnedRows,requests:s.network.requests}))))
}catch(e){await writeFile(destination,JSON.stringify({kind,status:'failed',error:e.stack,samples},null,2),{flag:'wx'});throw e}
finally{clearInterval(timer);dbNative.close()}
