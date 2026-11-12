import { readdir, readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { loadLocalCredential } from '../../server/realtime/credentials.ts'

const root=resolve('dist')
const credentials=loadLocalCredential()
const password=process.env.GRANDLYON_PASSWORD||credentials?.password||''
const username=process.env.GRANDLYON_USERNAME||credentials?.username||''
const needles=['GRANDLYON_PASSWORD','realtime-credential.local.json',...(password.length>=6?[password]:[]),...(username&&password?[Buffer.from(`${username}:${password}`).toString('base64')]:[])]
let files=0,bytes=0
async function walk(directory){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const path=resolve(directory,entry.name)
  if(entry.isDirectory()){await walk(path);continue}
  if(!['.js','.html','.json','.css','.map'].includes(extname(entry.name)))continue
  const data=await readFile(path,'utf8');files++;bytes+=Buffer.byteLength(data)
  for(const needle of needles)if(data.includes(needle))throw new Error(`Secret ou marqueur serveur détecté dans un fichier distribué : ${path.slice(root.length+1)}`)
 }
}
await walk(root)
let logs=0
for(const entry of await readdir(resolve('.data'),{withFileTypes:true})){
 if(!entry.isFile()||!entry.name.endsWith('.log'))continue
 const data=await readFile(resolve('.data',entry.name),'utf8');logs++
 for(const needle of needles)if(data.includes(needle))throw new Error(`Secret ou marqueur serveur détecté dans un journal : ${entry.name}`)
}
console.log(JSON.stringify({status:'passed',files,bytes,logs,credentialConfigured:Boolean(username&&password),checkedActualPassword:password.length>=6}))
