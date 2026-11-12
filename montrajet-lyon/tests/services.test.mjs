import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFavorites, writeFavorites } from '../src/services/favorites.ts'
import { transportServices } from '../src/services/transport.ts'
let storage
beforeEach(() => {
  storage = new Map()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  } })
})
test('Un nouveau navigateur ne contient aucun favori', () => {
  assert.deepEqual(readFavorites(), { items: [], error: '' })
})
test('Les favoris restent lisibles après enregistrement et suppression', () => {
  const items = [{ id: '1', departure: 'Départ saisi', arrival: 'Destination saisie' }]
  assert.equal(writeFavorites(items), '')
  assert.deepEqual(readFavorites().items, items)
  assert.equal(writeFavorites([]), '')
  assert.deepEqual(readFavorites().items, [])
})
test('Un stockage corrompu ou de forme incorrecte produit un avertissement', () => {
  for (const value of ['{', '{}', '[null]', '[{"id":"1","departure":" ","arrival":"A"}]']) {
    storage.set('montrajet-lyon:favorites:v1', value)
    assert.deepEqual(readFavorites().items, [])
    assert.ok(readFavorites().error)
  }
})
test('Les identifiants dupliqués sont rejetés', () => {
  const item = { id: '1', departure: 'A', arrival: 'B' }
  storage.set('montrajet-lyon:favorites:v1', JSON.stringify([item, item]))
  assert.ok(readFavorites().error)
})
test('Les refus du stockage sont gérés sans exception', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage denied') } })
  assert.ok(readFavorites().error)
  assert.ok(writeFavorites([]))
})
test('Aucun adaptateur non connecté ne renvoie de donnée de transport', async () => {
  const results = await Promise.all([
    transportServices.gtfs.searchStops('test'), transportServices.gtfs.searchLines('test'),
    transportServices.passages.get('test', 'test'), transportServices.disruptions.get(),
    transportServices.journeys.search({ departure: 'A', arrival: 'B', dateTime: '2026-11-08T12:00', mode: 'departure' }),
  ])
  for (const result of results) {
    assert.equal(result.status, 'disconnected')
    assert.ok(result.message)
    assert.equal('data' in result, false)
  }
})
