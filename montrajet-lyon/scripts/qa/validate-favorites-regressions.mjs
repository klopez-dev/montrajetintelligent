import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir,writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { startLocalServer } from './local-server.mjs'

const directory=resolve(`.data/favorites-regressions-${Date.now()}`);await mkdir(directory)
const report={checks:[],notes:['Suites exécutées sur un seul serveur afin de réutiliser les caches officiels.']};let server
try{
  server=await startLocalServer()
  for(const script of ['validate-journeys.mjs','validate-horaires.mjs','validate-mobility.mjs','validate-traffic.mjs','validate-experience.mjs']){
    const env={...process.env,TEST_BASE_URL:server.url,TRAFFIC_SKIP_REGRESSION:'true'}
    if(script==='validate-experience.mjs')delete env.TEST_BASE_URL // This suite must observe real cold IGN phases.
    const result=await promisify(execFile)(process.execPath,[resolve('scripts/qa',script)],{env,windowsHide:true,maxBuffer:3000000,timeout:300000});console.log(result.stdout);report.checks.push({script,status:'passed'})
  }
  report.status='passed'
}catch(error){report.status='failed';report.error=error.stack;report.stdout=error.stdout;report.stderr=error.stderr;console.error(error);process.exitCode=1}
finally{server?.close();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(directory)}
