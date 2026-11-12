import { test,after } from 'node:test'
import assert from 'node:assert/strict'
import { localDateCandidates } from '../src/services/localDateTime.ts'
const previous=process.env.TZ
process.env.TZ='Europe/Paris'
after(()=>{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous})
test('Saisie locale : heure inexistante refusée et heure répétée proposée deux fois',()=>{
  assert.deepEqual(localDateCandidates('2026-03-29T02:30'),[])
  assert.deepEqual(localDateCandidates('2026-10-25T02:30').map(time=>new Date(time).toISOString()),['2026-10-25T00:30:00.000Z','2026-10-25T01:30:00.000Z'])
})
test('Saisie locale normale, invalide ou date impossible',()=>{
  assert.deepEqual(localDateCandidates('2026-11-09T11:00').map(time=>new Date(time).toISOString()),['2026-11-09T10:00:00.000Z'])
  assert.deepEqual(localDateCandidates('2026-02-30T11:00'),[])
  assert.deepEqual(localDateCandidates('x'),[])
})
