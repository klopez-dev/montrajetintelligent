import {mkdir,writeFile} from 'node:fs/promises'
const output='.data/traffic-source-audit-'+Date.now();await mkdir(output)
const report={at:new Date().toISOString(),checks:[]}
for(const url of ['https://www.data.gouv.fr/api/1/datasets/alertes-trafic-du-reseau-des-transports-en-commun-lyonnais-v2/','https://www.tcl.fr/robots.txt','https://www.tcl.fr/infos-trafic','https://www.tcl.fr/se-deplacer/travaux-en-cours-sur-le-reseau-tcl']){
 const start=performance.now()
 try{const r=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});const body=await r.text();const entry={url,status:r.status,ms:performance.now()-start,type:r.headers.get('content-type'),bytes:Buffer.byteLength(body)}
 if(url.includes('api/1/datasets')){const d=JSON.parse(body);entry.dataset={id:d.id,organization:d.organization?.name,license:d.license,frequency:d.frequency,last_update:d.last_update,resources:d.resources?.map(x=>({id:x.id,url:x.url,format:x.format,last_modified:x.last_modified})),description:d.description};await writeFile(output+'/metadata.json',body)}
 else{await writeFile(output+'/'+(url.endsWith('robots.txt')?'robots.txt':url.includes('travaux')?'works.html':'traffic.html'),body);if(url.endsWith('robots.txt'))entry.body=body}
 report.checks.push(entry);console.log(JSON.stringify(entry))
 }catch(error){report.checks.push({url,error:error.message})}
}
await writeFile(output+'/report.json',JSON.stringify(report,null,2));console.log(output)
