/** Audit-only helpers. No runtime instrumentation or personal request logging. */
export const cpuMs=usage=>(usage.user+usage.system)/1000
export function intervalUnionMs(intervals){
  let total=0,end=-Infinity
  for(const [a,b] of [...intervals].sort((a,b)=>a[0]-b[0])){
    if(!Number.isFinite(a)||!Number.isFinite(b)||b<a)throw new Error('Invalid interval')
    total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b)
  }
  return total
}
export function summarize(values){
  if(!values.length)return null
  const v=[...values].sort((a,b)=>a-b)
  return {count:v.length,min:v[0],median:v[Math.floor(v.length/2)],max:v.at(-1)}
}
export function freeD1WriteDays(rows,daily=100000){
  if(!Number.isSafeInteger(rows)||rows<0||!Number.isSafeInteger(daily)||daily<1)throw new Error('Invalid row budget')
  return Math.ceil(rows/daily)
}
