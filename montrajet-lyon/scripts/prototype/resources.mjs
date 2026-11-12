import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const directory=resolve(process.argv[2]||''),output=resolve(`.data/hybrid-resources-${Date.now()}`);await mkdir(output);const reports=[]
for(const kind of ['direct','one','two'])for(const mode of ['sqlite','compact','static']){
 const file=resolve(output,kind+'-'+mode+'.json');await promisify(execFile)(process.execPath,[resolve('scripts/prototype/resource-job.mjs'),mode,kind,directory,file],{windowsHide:true,timeout:120000,maxBuffer:100000})
 const report=JSON.parse(await readFile(file,'utf8'));reports.push(report);console.log(JSON.stringify({kind,mode,wallMs:report.samples[0].wallMs,heapBytes:report.samples[0].memory.heapUsed,externalBytes:report.samples[0].memory.external,maxRssKiB:report.maxRssKiB}))
}
await writeFile(resolve(output,'report.json'),JSON.stringify({reports},null,2),{flag:'wx'});console.log(output)
