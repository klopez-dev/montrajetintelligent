import test from 'node:test'
import assert from 'node:assert/strict'
import { removeDominatedJourneys } from '../server/journeys/network.ts'

const reference = all => all.filter(b => !all.some(a => a !== b &&
  a.legs[0].from.id === b.legs[0].from.id && a.legs.at(-1).to.id === b.legs.at(-1).to.id &&
  Date.parse(a.departureTime) >= Date.parse(b.departureTime) && Date.parse(a.arrivalTime) <= Date.parse(b.arrivalTime) && a.transfers < b.transfers))

test('Filtre de dominance rapide identique à la référence quadratique, y compris égalités et quais différents', () => {
  let state = 123456789
  const random = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n }
  const base = Date.parse('2026-11-09T10:00:00Z')
  for (let trial = 0; trial < 40; trial++) {
    const all = Array.from({ length: 60 }, (_, index) => {
      const departure = base + random(180) * 60000, arrival = departure + (5 + random(90)) * 60000
      return { id: String(index), departureTime: new Date(departure).toISOString(), arrivalTime: new Date(arrival).toISOString(), transfers: random(3), legs: [{ from: { id: String(random(4)) }, to: { id: String(random(4)) } }] }
    })
    assert.deepEqual(removeDominatedJourneys(all).map(x => x.id), reference(all).map(x => x.id))
  }
  const equal = [0, 1, 2].map(transfers => ({ id: String(transfers), departureTime: new Date(base).toISOString(), arrivalTime: new Date(base + 600000).toISOString(), transfers, legs: [{ from: { id: 'A' }, to: { id: 'B' } }] }))
  assert.deepEqual(removeDominatedJourneys(equal).map(x => x.id), ['0'])
})
