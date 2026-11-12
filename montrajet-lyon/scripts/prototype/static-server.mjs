import {createServer} from 'node:http'
import {readFile,readdir} from 'node:fs/promises'
import {resolve,extname} from 'node:path'
/** QA file server only: no SQLite import, no API fallback, localhost ephemeral port. */
export async function startStatic(directory,control={}){
 const files=new Set((await readdir(directory,{recursive:true,withFileTypes:true})).filter(f=>f.isFile()).map(f=>resolve(f.parentPath,f.name)))
 const requests=[]
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname,file=resolve(directory,'.'+pathname);requests.push(pathname)
  if(!files.has(file)){res.statusCode=404;res.end('Absent');return}
  if(control.delayMs&&pathname.includes('prototype-data'))await new Promise(ok=>setTimeout(ok,control.delayMs))
  if(control.fail&&pathname.includes(control.fail)){res.statusCode=503;res.end('QA provider failure');return}
  try{const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json'})[extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
   if(control.throughputBytes&&pathname.includes('prototype-data')){
    for(let n=0;n<data.length&&!res.destroyed;n+=32768){res.write(data.subarray(n,n+32768));await new Promise(ok=>setTimeout(ok,32768/control.throughputBytes*1000))}res.end()
   }else res.end(control.corrupt&&pathname.includes(control.corrupt)?Buffer.alloc(data.length):data)
  }catch{res.statusCode=503;res.end()}
 })
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok))
 return{url:`http://127.0.0.1:${server.address().port}/experiments/hybrid/index.html?standalone=1`,requests,close:()=>new Promise(ok=>server.close(ok))}
}
