import {test} from 'node:test'
import assert from 'node:assert/strict'
import {intervalUnionMs,cpuMs,summarize,freeD1WriteDays} from '../scripts/audit/metrics.mjs'
test('Audit : union des attentes parallèles, pas une addition de durées qui se chevauchent',()=>{
  assert.equal(intervalUnionMs([[5,10],[0,8],[12,15]]),13)
  assert.equal(intervalUnionMs([]),0);assert.throws(()=>intervalUnionMs([[9,2]]))
})
test('Audit : unités CPU, médiane et bornes de mesure explicites',()=>{
  assert.equal(cpuMs({user:1500,system:500}),2)
  assert.deepEqual(summarize([5,1,3]),{count:3,min:1,median:3,max:5});assert.equal(summarize([]),null)
})
test('Audit : minimum théorique des jours D1 sans prétendre inclure le coût des index',()=>{
  assert.equal(freeD1WriteDays(2927249),30);assert.equal(freeD1WriteDays(0),0)
  assert.throws(()=>freeD1WriteDays(-1));assert.throws(()=>freeD1WriteDays(10,0))
})
