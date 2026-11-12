import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const directory=resolve(process.argv[2]||''),output=resolve(`.data/hybrid-repeated-${Date.now()}`);await mkdir(output);const reports=[],groups={}
function stats(values){const a=values.toSorted((a,b)=>a-b);return{n:a.length,min:a[0],median:a[Math.floor(a.length/2)],p95:a[Math.ceil(a.length*.95)-1],max:a.at(-1)}}
for(const kind of ['direct','one','two'])for(const mode of ['sqlite','static'])for(let repeat=0;repeat<5;repeat++){
 const file=resolve(output,`${kind}-${mode}-${repeat}.json`);await promisify(execFile)(process.execPath,[resolve('scripts/prototype/resource-job.mjs'),mode,kind,directory,file],{windowsHide:true,timeout:120000,maxBuffer:100000})
 const report=JSON.parse(await readFile(file,'utf8'));reports.push(report);console.log(kind,mode,repeat,report.samples[0].wallMs.toFixed(1))
}
for(const kind of ['direct','one','two'])for(const mode of ['sqlite','static']){const rows=reports.filter(r=>r.kind===kind&&r.mode===mode);groups[kind+'-'+mode]={coldCalculationMs:stats(rows.map(r=>r.samples[0].wallMs)),warmCalculationMs:stats(rows.flatMap(r=>r.samples.slice(1).map(s=>s.wallMs))),totalThreeCalculationsAndInitMs:stats(rows.map(r=>r.totalMs)),coldCpuMs:stats(rows.map(r=>r.samples[0].cpuMs)),maxRssKiB:stats(rows.map(r=>r.maxRssKiB))}}
await writeFile(resolve(output,'report.json'),JSON.stringify({reports,groups,notes:['Five fresh processes per case/mode, two warm calls each. Node wall/CPU/RSS are not browser or Cloudflare metrics.']},null,2),{flag:'wx'});console.log(output)
