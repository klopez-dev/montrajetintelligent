import {mkdir,writeFile} from 'node:fs/promises'
import {createTrafficProvider} from '../../server/traffic/provider.ts'
const dir='.data/traffic-reliability-before-'+Date.now();await mkdir(dir)
const requests=[]
const fetcher=async(...args)=>{const t=performance.now(),r=await fetch(...args);requests.push({url:String(args[0]),status:r.status,ms:performance.now()-t});const copy=r.clone();if(r.ok)await writeFile(dir+'/page-'+requests.length+'.html',await copy.text());return r}
const provider=createTrafficProvider(fetcher),t=performance.now(),snapshot=await provider.get(),samples=[]
for(let i=0;i<5;i++){const t=performance.now();const result=await provider.get();samples.push({ms:performance.now()-t,metrics:result.metrics})}
await writeFile(dir+'/report.json',JSON.stringify({clientDate:'2026-11-09',snapshot,coldMs:performance.now()-t,requests,samples},null,2));console.log(dir,snapshot.state,snapshot.incidents.length,snapshot.metrics)
