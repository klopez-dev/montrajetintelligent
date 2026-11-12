import {DatabaseSync} from 'node:sqlite'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createJourneyPlanner} from '../../server/journeys/planner.ts'
import {createNetworkPlanner} from '../../server/journeys/network.ts'
import {loadStaticDatabase} from '../../experiments/hybrid/load.ts'
import {auditJourney} from '../../tests/helpers/journeys.mjs'
import {cpuMs} from '../audit/metrics.mjs'

const directory=resolve(process.argv[2]||''),candidate=resolve('.data/cost-audit-compact-1794251552460/candidate.sqlite'),output=resolve(`.data/hybrid-comparison-${Date.now()}`);await mkdir(output)
const source=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),compact=new DatabaseSync(candidate,{readOnly:true})
compact.exec('CREATE TEMP VIEW stop_times AS SELECT tk.gtfs_id AS trip_id,sk.gtfs_id AS stop_id,a.sequence,a.arrival,a.departure,a.headsign,a.pickup_type,a.drop_off_type,a.timepoint FROM audit_stop_times a JOIN audit_trip_keys tk ON tk.idx=a.trip_idx JOIN audit_stop_keys sk ON sk.idx=a.stop_idx')
const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8')),report={startedAt:new Date().toISOString(),directory,cases:[],divergences:[],notes:['Isolated prototype only. No active base modified. Node measurements are not Workers CPU.','Compact SQL uses a TEMP view on a read-only candidate; no persistent schema change.']}
const base={all:async(sql,p=[])=>source.prepare(sql).all(...p)},optimized={all:async(sql,p=[])=>compact.prepare(sql).all(...p)}
const cases=[['direct','35660','35668','2026-11-09T10:00:00Z','departure'],['one','2397','36394','2026-11-09T10:00:00Z','departure'],['two','1138','36394','2026-11-09T10:00:00Z','departure'],['arrive-before','1138','36394','2026-11-09T11:00:00Z','arrival'],['after-midnight','35660','35668','2026-11-09T23:05:00Z','departure'],['sunday','35660','35668','2026-11-08T10:00:00Z','departure'],['outside-validity','35660','35668','2028-01-01T10:00:00Z','departure']]
const canonical=r=>({state:r.state,itineraries:r.itineraries,scope:r.scope,warnings:r.warnings})
try{
 for(const [name,fromStopId,toStopId,at,mode] of cases){
   const q={fromStopId,toStopId,at,mode,order:mode==='arrival'?'departure':'arrival',marginSeconds:120,maxTransfers:2},sample={name,query:q,implementations:[]};let reference
   for(const implementation of ['sqlite','compact','static']){
     let compressedBytes=0,loadMs=0,db,planner
     const loadStart=performance.now(),before=process.memoryUsage()
     if(implementation==='static')db=await loadStaticDatabase(manifest,async f=>{const b=await readFile(resolve(directory,f));compressedBytes+=b.length;return b})
     else db=implementation==='sqlite'?base:optimized
     loadMs=performance.now()-loadStart
     planner=implementation==='static'?createNetworkPlanner(db):createJourneyPlanner(db)
     const samples=[]
     for(let repeat=0;repeat<3;repeat++){
       const cpu=process.cpuUsage(),start=performance.now(),r=await planner.search(q),wallMs=performance.now()-start,used=cpuMs(process.cpuUsage(cpu))
       for(const journey of r.itineraries)auditJourney(source,r,journey)
       if(implementation==='sqlite'&&repeat===0)reference=canonical(r)
       const equal=JSON.stringify(reference)===JSON.stringify(canonical(r));if(!equal)report.divergences.push({name,implementation,repeat,reference,actual:canonical(r)})
       samples.push({repeat,wallMs,cpuMs:used,compressedBytes,metrics:r.metrics,proposals:r.itineraries.length,state:r.state,equal,afterMemory:process.memoryUsage()})
     }
     sample.implementations.push({implementation,loadMs,beforeMemory:before,samples})
   }
   report.cases.push(sample);console.log(name,JSON.stringify(sample.implementations.map(i=>({implementation:i.implementation,loadMs:i.loadMs,coldMs:i.samples[0].wallMs,cpuMs:i.samples[0].cpuMs,bytes:i.samples[0].compressedBytes,equal:i.samples.every(s=>s.equal)}))))
 }
 report.status=report.divergences.length?'divergent':'passed'
 if(report.divergences.length)process.exitCode=1
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;console.error(e)}
finally{source.close();compact.close();await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
