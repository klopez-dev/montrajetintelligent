import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const directory=resolve(`.data/cost-audit-routing-${Date.now()}`);await mkdir(directory)
const kinds=process.env.AUDIT_LIVE==='true'?['direct','one','two','timetable','address-address','address-stop','commute']:['direct','one','two','timetable']
const report={startedAt:new Date().toISOString(),cases:[],notes:['Serial, isolated child processes. Live IGN only with AUDIT_LIVE=true. No deployment, no production change.']}
for(const kind of kinds){
  const output=resolve(directory,kind+'.json')
  try{
    const child=await promisify(execFile)(process.execPath,[resolve('scripts/audit/routing-job.mjs'),kind,output],{windowsHide:true,timeout:240000,maxBuffer:200000})
    console.log(child.stdout);report.cases.push(JSON.parse(await readFile(output,'utf8')))
  }catch(e){report.cases.push({kind,status:'failed',error:e.message});process.exitCode=1;console.error(kind,e.message)}
}
report.status=report.cases.every(c=>c.status==='passed')?'passed':'failed'
await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(directory)
