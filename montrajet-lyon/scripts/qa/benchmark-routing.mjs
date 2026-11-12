import { DatabaseSync } from 'node:sqlite'
import { mkdir,writeFile } from 'node:fs/promises'
import { createIgnProvider } from '../../server/mobility/provider.ts'
import { createMobilityPlanner } from '../../server/mobility/planner.ts'

const label=process.argv[2]||'after'
if(!['before','after'].includes(label))throw Error('before|after')
const output=`.data/benchmark-${label}-${Date.now()}`;await mkdir(output)
const sqlite=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true})
const address={kind:'address',id:'address:69383_4080_00100',name:'100 Avenue Lacassagne 69003 Lyon'}
const cases=[
  {name:'Place Henri → Soie, liens piétons',from:{kind:'stop',id:'2397'},to:{kind:'stop',id:'35668'},walkingTransfers:true},
  {name:'Adresse → Soie',from:address,to:{kind:'stop',id:'35668'},walkingTransfers:true},
  {name:'Deux adresses',from:address,to:{kind:'address',id:'address:69256_0227_00005',name:'5 Avenue des Canuts 69120 Vaulx-en-Velin'},walkingTransfers:true},
  {name:'T3 long → Meyzieu',from:{kind:'stop',id:'35660'},to:{kind:'stop',id:'46207'},walkingTransfers:false},
]
const report={label,at:new Date().toISOString(),cases:[],notes:['Cold = nouveaux caches applicatifs, pas vidage du cache disque du système.','Durées enveloppes de méthodes : réseau et files inclus. SQLite mesuré séparément.','Les temps cumulés des opérations parallèles peuvent dépasser le temps mur.']}
try{
  for(const scenario of cases){
    let sample
    const db={all:async(sql,params=[])=>{const start=performance.now();try{return sqlite.prepare(sql).all(...params)}finally{sample.sqlMs+=performance.now()-start;sample.sqlQueries++}}}
    let fetching=0
    const provider=createIgnProvider(async(...args)=>{
      const url=String(args[0]),geo=url.includes('/geocodage/'),start=performance.now();fetching++;sample.maxConcurrent=Math.max(sample.maxConcurrent,fetching);sample.upstream++
      try{return await fetch(...args)}finally{sample[geo?'geocodingNetworkMs':'walkingNetworkMs']+=performance.now()-start;fetching--}
    })
    const wrapped={addresses:async(...args)=>{const t=performance.now();try{return await provider.addresses(...args)}finally{sample.geocodingMs+=performance.now()-t}},walk:async(...args)=>{const t=performance.now();try{return await provider.walk(...args)}finally{sample.walkingMs+=performance.now()-t;sample.walkRequests++}}}
    const planner=createMobilityPlanner(db,wrapped)
    const entry={name:scenario.name,samples:[]}
    for(let i=0;i<3;i++){
      sample={cache:i?'warm':'cold',sqlMs:0,sqlQueries:0,geocodingMs:0,walkingMs:0,geocodingNetworkMs:0,walkingNetworkMs:0,walkRequests:0,upstream:0,maxConcurrent:0}
      const start=performance.now()
      try{
        const result=await planner.search({at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:120,...scenario})
        Object.assign(sample,{state:result.state,proposals:result.itineraries.length,metrics:result.metrics,first:result.itineraries[0]&&{departure:result.itineraries[0].departureTime,arrival:result.itineraries[0].arrivalTime,lines:result.itineraries[0].transit.legs.map(l=>l.lineName)}})
      }catch(error){sample.error=error.message}
      sample.totalMs=performance.now()-start;sample.nonSqlNonProviderMs=Math.max(0,sample.totalMs-sample.sqlMs-sample.geocodingMs-sample.walkingMs)
      entry.samples.push(sample);console.log(scenario.name,sample.cache,Math.round(sample.totalMs)+' ms',sample.state||sample.error,'SQL',Math.round(sample.sqlMs),'IGN',sample.upstream)
    }
    report.cases.push(entry)
  }
}finally{sqlite.close();await writeFile(output+'/report.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(output+'/report.json')}
