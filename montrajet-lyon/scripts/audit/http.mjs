import {writeFile} from 'node:fs/promises'
import {startLocalServer} from '../qa/local-server.mjs'
const server=await startLocalServer(),report={checkedAt:new Date().toISOString(),scope:'Local Vite only, not production HTTP or Cloudflare',checks:[]}
try{
 const checks=[['frontend','/'],['gtfs-status','/api/gtfs/status'],['invalid-date','/api/journeys/search?fromStopId=35660&toStopId=35668&at=INVALID'],['invalid-geometry','/api/mobility/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({from:{kind:'address',id:'TEST',name:'TEST',expectedCoordinates:{latitude:999,longitude:4}},to:{kind:'stop',id:'35668'},at:'2026-11-09T10:00:00Z',mode:'departure',marginSeconds:120,order:'arrival',walkingTransfers:false})}],['raw-database','/.data/gtfs.sqlite'],['raw-archive','/GTFS_TCL.ZIP'],['map-feed-conflict','/api/maps',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({feedSha256:'TEST_CHANGED_FEED',legs:[{tripId:'TEST',fromStopId:'TEST_A',toStopId:'TEST_B',fromSequence:0,toSequence:1}]})}]]
 for(const [name,path,init] of checks){
  const response=await fetch(server.url+path,{...init,signal:AbortSignal.timeout(10000)}),reader=response.body?.getReader()
  // Never read private datasets: only the first small chunk if the server mistakenly serves one.
  let prefix='';if(reader){const {value}=await reader.read();prefix=new TextDecoder().decode(value?.subarray(0,160));await reader.cancel()}
  report.checks.push({name,status:response.status,contentType:response.headers.get('content-type'),headers:Object.fromEntries(['content-security-policy','x-content-type-options','x-frame-options','referrer-policy','strict-transport-security','cache-control'].map(k=>[k,response.headers.get(k)])),datasetSignatureDetected:prefix.startsWith('SQLite format')||(prefix.startsWith('PK')&&prefix.charCodeAt(2)===3&&prefix.charCodeAt(3)===4)})
 }
 report.status=report.checks.every(c=>!c.datasetSignatureDetected)&&report.checks.find(c=>c.name==='invalid-date').status===400&&report.checks.find(c=>c.name==='invalid-geometry').status===400?'passed':'failed'
 const output=`.data/cost-audit-http-${Date.now()}.json`;await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(output);console.log(JSON.stringify(report.checks.map(c=>({name:c.name,status:c.status,signature:c.datasetSignatureDetected,headers:c.name==='frontend'?c.headers:undefined}))))
 if(report.status!=='passed')process.exitCode=1
}finally{server.close()}
