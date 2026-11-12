import {DatabaseSync} from 'node:sqlite'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createNetworkPlanner} from '../../server/journeys/network.ts'
import {loadStaticDatabase} from '../../experiments/hybrid/load.ts'
import {cpuMs} from '../audit/metrics.mjs'
const [mode,kind,directory,output]=process.argv.slice(2)
if(!['sqlite','compact','static'].includes(mode)||!['direct','one','two'].includes(kind))throw new Error('Invalid measurement case')
const start=performance.now(),cpu=process.cpuUsage(),memoryBefore=process.memoryUsage();let native,db,bytes=0
if(mode==='static'){const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'));db=await loadStaticDatabase(manifest,async f=>{const b=await readFile(resolve(directory,f));bytes+=b.length;return b})}
else{
 native=new DatabaseSync(mode==='sqlite'?'.data/gtfs.sqlite':'.data/cost-audit-compact-1794251552460/candidate.sqlite',{readOnly:true})
 if(mode==='compact')native.exec('CREATE TEMP VIEW stop_times AS SELECT tk.gtfs_id AS trip_id,sk.gtfs_id AS stop_id,a.sequence,a.arrival,a.departure,a.headsign,a.pickup_type,a.drop_off_type,a.timepoint FROM audit_stop_times a JOIN audit_trip_keys tk ON tk.idx=a.trip_idx JOIN audit_stop_keys sk ON sk.idx=a.stop_idx')
 db={all:async(s,p=[])=>native.prepare(s).all(...p)}
}
const planner=createNetworkPlanner(db),q={fromStopId:{direct:'35660',one:'2397',two:'1138'}[kind],toStopId:kind==='direct'?'35668':'36394',at:'2026-11-09T10:00:00Z',mode:'departure',order:'arrival',marginSeconds:120,maxTransfers:2},samples=[]
try{
 for(let i=0;i<3;i++){const at=performance.now(),c=process.cpuUsage(),result=await planner.search(q);samples.push({cache:i?'warm':'cold',wallMs:performance.now()-at,cpuMs:cpuMs(process.cpuUsage(c)),memory:process.memoryUsage(),state:result.state,proposals:result.itineraries.length})}
 await writeFile(output,JSON.stringify({mode,kind,memoryBefore,samples,compressedBytes:bytes,totalMs:performance.now()-start,totalCpuMs:cpuMs(process.cpuUsage(cpu)),maxRssKiB:process.resourceUsage().maxRSS,notes:['Fresh process per implementation/case. Sampled heap is not peak; RSS includes Node/native SQLite. No browser or Workers CPU inference.']},null,2),{flag:'wx'})
}finally{native?.close()}
