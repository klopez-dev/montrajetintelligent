import {createServer} from 'node:http'
import {readFile,readdir} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
import {pathToFileURL} from 'node:url'
/** Only serves built files. No SQLite, Vite middleware, API or supplier relay. */
export async function servePreproduction(directory,control={}){
 const allowed=new Set((await readdir(directory,{recursive:true,withFileTypes:true})).filter(f=>f.isFile()).map(f=>resolve(f.parentPath,f.name))),rules=[]
 let current
 for(const line of (await readFile(resolve(directory,'_headers'),'utf8')).split('\n')){if(line.startsWith('/')){current={pattern:new RegExp('^'+line.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*')+'$'),headers:{}};rules.push(current)}else if(current&&line.trim()){const split=line.indexOf(':');current.headers[line.slice(0,split).trim()]=line.slice(split+1).trim()}}
 const requests=[]
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname,file=resolve(directory,'.'+path);requests.push(path)
  if(!allowed.has(file)||path.includes('..')||path.startsWith('/api/')){res.statusCode=404;res.end('Fichier statique absent');return}
  for(const rule of rules)if(rule.pattern.test(path))for(const [key,value]of Object.entries(rule.headers))res.setHeader(key,value)
  if(control.delayMs&&path.includes('prototype-data'))await new Promise(ok=>setTimeout(ok,control.delayMs))
  if(control.fail&&path.includes(control.fail)){res.statusCode=503;res.end();return}
  try{let bytes=await readFile(file);if(control.transform)bytes=control.transform(path,bytes);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.txt':'text/plain'})[extname(file)]||'application/octet-stream');if(control.corrupt&&path.includes(control.corrupt)){res.end(Buffer.alloc(bytes.length));return}
   if(control.throughputBytes&&path.includes('prototype-data')){for(let n=0;n<bytes.length&&!res.destroyed;n+=32768){res.write(bytes.subarray(n,n+32768));await new Promise(ok=>setTimeout(ok,32768/control.throughputBytes*1000))}res.end()}else res.end(bytes)
  }catch{res.statusCode=503;res.end()}
 });await new Promise(ok=>server.listen(0,'127.0.0.1',ok));return{url:`http://127.0.0.1:${server.address().port}/experiments/preproduction/index.html`,requests,close:()=>new Promise(ok=>server.close(ok))}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const server=await servePreproduction(resolve(process.argv[2]||''));console.log(server.url)}
