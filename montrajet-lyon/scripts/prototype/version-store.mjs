import {mkdir,readFile,writeFile,copyFile,rename,open,unlink} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {loadStaticDatabase} from '../../experiments/hybrid/load.ts'
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
async function pointer(store){try{return JSON.parse(await readFile(resolve(store,'current.json'),'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}}
async function verify(directory){
 const bytes=await readFile(resolve(directory,'manifest.json')),manifest=JSON.parse(bytes),db=await loadStaticDatabase(manifest,f=>readFile(resolve(directory,f)))
 for(const date of Object.keys(manifest.days))await db.packet(date)
 db.release();return{version:sha(bytes),manifest,bytes}
}
/** Offline publication rehearsal only. Each immutable package is verified before
 * replacing one local pointer by rename, under an exclusive local writer lock.
 * This is not a Cloudflare deployment or an active application data directory.
 */
export async function publishLocal(directory,store,expectedVersion=null,rollback=false){
 await mkdir(store,{recursive:true});const lock=await open(resolve(store,'writer.lock'),'wx')
 try{
  const current=await pointer(store)
  if((current?.current??null)!==expectedVersion)throw new Error('Version courante modifiée : publication refusée')
  let checked
  if(rollback){if(!current?.previous||!/^[a-f0-9]{64}$/.test(current.previous))throw new Error('Aucune version précédente');checked=await verify(resolve(store,current.previous));if(checked.version!==current.previous)throw new Error('Version précédente corrompue')}
  else{
   checked=await verify(directory)
   const target=resolve(store,checked.version)
   try{await mkdir(target)}catch(e){if(e.code!=='EEXIST')throw e;const existing=await verify(target);if(existing.version!==checked.version)throw new Error('Version stockée corrompue')}
   // Existing immutable snapshots are never overwritten.
   const files=[checked.manifest.catalog.file,...Object.values(checked.manifest.days).flatMap(d=>[d.file,...(d.trips?[d.trips.file]:[])])]
   for(const file of files){try{await copyFile(resolve(directory,file),resolve(target,file),1)}catch(e){if(e.code!=='EEXIST')throw e}}
   try{await writeFile(resolve(target,'manifest.json'),checked.bytes,{flag:'wx'})}catch(e){if(e.code!=='EEXIST')throw e}
   const copied=await verify(target);if(copied.version!==checked.version)throw new Error('Copie de version invalide')
  }
  const next={current:checked.version,previous:current?.current??null,changedAt:new Date().toISOString(),scope:'local rehearsal only'},temp=resolve(store,'pointer-'+randomUUID()+'.tmp')
  await writeFile(temp,JSON.stringify(next,null,2),{flag:'wx'});await rename(temp,resolve(store,'current.json'));return next
 }finally{await lock.close();await unlink(resolve(store,'writer.lock'))}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const store=resolve('.data/hybrid-publication'),old=await pointer(store);console.log(JSON.stringify(await publishLocal(resolve(process.argv[2]||''),store,old?.current??null,process.argv[2]==='rollback')))}
