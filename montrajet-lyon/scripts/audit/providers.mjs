import {writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const checks=[
 ['gtfs-download','https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP','HEAD'],
 ['grandlyon-realtime','https://data.grandlyon.com/fr/datapusher/ws/rdata/tcl_sytral.tclpassagearret/all.json','GET'],
 ['tcl-robots','https://www.tcl.fr/robots.txt','GET'],
 ['tcl-legal','https://www.tcl.fr/mentions-legales','GET'],
 ['osm-policy','https://operations.osmfoundation.org/policies/tiles/','GET'],
]
const report={checkedAt:new Date().toISOString(),checks:[],notes:['Fixed official URLs, no authentication, redirects not followed, no archive download or tile fetch. No credentials or personal address stored.']}
for(const [name,url,method] of checks){
 const at=performance.now()
 try{
   const response=await fetch(url,{method,redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'MonTrajetLyon/0.1 (local readiness audit)',Accept:name==='grandlyon-realtime'?'application/json':'text/html,text/plain,*/*'}})
   const check={name,url,method,status:response.status,elapsedMs:performance.now()-at,contentType:response.headers.get('content-type'),contentLength:response.headers.get('content-length'),lastModified:response.headers.get('last-modified')}
   if(['tcl-robots','tcl-legal','osm-policy'].includes(name)&&response.ok){
     const text=await response.text();if(text.length>1500000)throw new Error('Policy document too large')
     check.bodySha256=createHash('sha256').update(text).digest('hex')
     if(name==='tcl-legal')check.nonCommercialReproductionPermissionFound=text.includes('pas soumise à autorisation préalable')&&text.includes('commerciales et publicitaires')
     if(name==='tcl-robots')check.trafficExplicitDisallow=/Disallow:\s*\/infos-trafic/i.test(text)
     if(name==='osm-policy')check.policyFound=text.includes('Tile Usage Policy')&&text.includes('Referer')
   }else await response.body?.cancel()
   report.checks.push(check);console.log(name,response.status)
 }catch(e){report.checks.push({name,url,method,error:e.message,elapsedMs:performance.now()-at});console.log(name,e.message)}
}
const output=`.data/cost-audit-providers-${Date.now()}.json`;await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});console.log(output)
