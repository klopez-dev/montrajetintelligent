import {writeFile} from 'node:fs/promises'
const metadataUrls=['https://transport.data.gouv.fr/api/datasets/5de42c4d8b4c417a10e62ec9','https://www.data.gouv.fr/api/1/datasets/5de42c4d8b4c417a10e62ec9/']
const report={checkedAt:new Date().toISOString(),metadata:[],probes:[],verdict:'SOURCE OFFICIELLE SOUS CONDITIONS',authenticatedDownloadVerified:false}
try{
 const url='https://transport.data.gouv.fr/resources/81943',r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(12000)}),html=await r.text()
 report.metadata.push({url,status:r.status,kind:'historical-third-party-derivative',links:[...html.matchAll(/href="([^"]*gtech[^"]*)"/g)].map(m=>{const link=new URL(m[1].replaceAll('&amp;','&'));const queryParameters=[...link.searchParams.keys()];link.search='';return {urlWithoutQuery:link.href,queryParameters,credentialValuesNotRetained:true}}),downloadAttempted:false,reason:'Public listing does not establish current producer authorisation; no third-party archive fetched.'})
}catch(e){report.metadata.push({url:'https://transport.data.gouv.fr/resources/81943',error:e.message})}
for(const url of metadataUrls){
 try{
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('HTTP '+response.status)
  const d=await response.json()
  report.metadata.push({url,status:response.status,title:d.title,licence:d.licence||d.license,updated:d.updated||d.last_modified,publisher:d.publisher||{name:d.organization?.name},resources:(d.resources||[]).map(r=>({id:r.id,url:r.original_url||r.url,reference:r.url,format:r.format,title:r.title,updated:r.last_modified})),officialBackups:(d.history||[]).filter(h=>h.resource_id===65812).map(h=>({url:h.payload.permanent_url,published:h.payload.download_datetime,validity:h.payload.resource_metadata}))})
 }catch(e){report.metadata.push({url,error:e.message});report.verdict='SOURCE NON RÉSOLUE'}
}
for(const url of ['https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP','https://sytral-mobilites.fr/fr/','https://data.grandlyon.com/portail/fr/connexion','https://rdata-grandlyon.readthedocs.io/fr/latest/authentification.html','https://rdata-grandlyon.readthedocs.io/fr/latest/bonne_pratique.html']){
 try{const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(12000)});report.probes.push({url,method:'GET',status:r.status,challenge:r.headers.get('www-authenticate'),lastModified:r.headers.get('last-modified'),contentType:r.headers.get('content-type'),location:r.headers.get('location')});await r.body?.cancel()}catch(e){report.probes.push({url,error:e.message})}
}
const path=`.data/gtfs-source-audit-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2),{flag:'wx'});console.log(path);console.log(JSON.stringify(report.probes))
