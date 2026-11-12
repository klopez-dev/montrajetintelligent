import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextExpiration, visiblePassages } from '../src/services/passageVisibility.ts'

const now = Date.parse('2026-11-09T10:00:00Z')
const passages = [-1000, 0, 60000].map(offset => ({ departureTime: new Date(now + offset).toISOString(), kind: 'theoretical' }))
test('Consultation maintenant : supprimer les départs strictement passés, garder maintenant', () => {
  assert.deepEqual(visiblePassages(passages, false, now), passages.slice(1))
  assert.deepEqual(visiblePassages(passages, false, now + 1), passages.slice(2))
})
test('La date choisie conserve son instantané même après écoulement du temps', () => {
  assert.deepEqual(visiblePassages(passages, true, now + 86400000), passages)
})
test('Programmer le retrait à la première milliseconde après le départ', () => {
  assert.equal(nextExpiration(passages, now), now + 1)
  assert.equal(nextExpiration(passages, now + 1), now + 60001)
})
test('Liste expirée ou vide : aucun horaire de substitution ni minuteur en boucle', () => {
  assert.deepEqual(visiblePassages(passages, false, now + 60001), [])
  assert.equal(nextExpiration(passages, now + 60001), null)
  assert.equal(nextExpiration([], now), null)
})
