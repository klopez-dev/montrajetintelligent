import test from 'node:test'
import assert from 'node:assert/strict'
import { createValhallaProvider } from '../server/mobility/valhalla.ts'
import { GeographicError, geographicTrace } from '../server/mobility/provider.ts'

const from = { latitude: 45.7488478, longitude: 4.8782357 }
const to = { latitude: 45.749865, longitude: 4.880478 }

function encode(points) {
  let previousLat = 0, previousLon = 0
  let result = ''

  function value(number) {
    let v = number < 0 ? ~(number << 1) : number << 1
    while (v >= 32) {
      result += String.fromCharCode((32 | (v & 31)) + 63)
      v >>>= 5
    }
    result += String.fromCharCode(v + 63)
  }

  for (const [lon, lat] of points) {
    const latitude = Math.round(lat * 1e6)
    const longitude = Math.round(lon * 1e6)
    value(latitude - previousLat)
    value(longitude - previousLon)
    previousLat = latitude
    previousLon = longitude
  }

  return result
}

function mockResponse(points = [
  [from.longitude, from.latitude],
  [to.longitude, to.latitude]
]) {
  return {
    trip: {
      summary: { length: 0.287, time: 209.488 },
      legs: [{ shape: encode(points) }]
    }
  }
}

test('parcours valide et cache', async () => {
  let calls = 0
  const provider = createValhallaProvider(async () => {
    calls++
    return new Response(JSON.stringify(mockResponse()), { status: 200 })
  })

  const trace = geographicTrace()
  const first = await provider.walk(from, to, trace)
  const second = await provider.walk(from, to, trace)

  assert.equal(first.source, 'Valhalla / OpenStreetMap')
  assert.equal(first.durationSeconds, 210)
  assert.equal(first.distanceMeters, 287)
  assert.equal(first.geometry.coordinates.length, 2)
  assert.equal(second, first)
  assert.equal(calls, 1)
  assert.equal(trace.cacheHits, 1)
})

test('erreur HTTP refusee', async () => {
  const provider = createValhallaProvider(async () =>
    new Response('', { status: 503 })
  )

  await assert.rejects(
    provider.walk(from, to),
    GeographicError
  )
})

test('reponse JSON invalide refusee', async () => {
  const provider = createValhallaProvider(async () =>
    new Response('not-json', { status: 200 })
  )

  await assert.rejects(
    provider.walk(from, to),
    GeographicError
  )
})

test('parcours sans geometrie refuse', async () => {
  const provider = createValhallaProvider(async () =>
    new Response(JSON.stringify({
      trip: { summary: { length: 0.2, time: 180 }, legs: [] }
    }), { status: 200 })
  )

  await assert.rejects(
    provider.walk(from, to),
    GeographicError
  )
})

test('raccordement superieur a 25 m refuse', async () => {
  const provider = createValhallaProvider(async () =>
    new Response(JSON.stringify(mockResponse([
      [from.longitude, from.latitude],
      [4.881, 45.7505]
    ])), { status: 200 })
  )

  await assert.rejects(
    provider.walk(from, to),
    /Acces au reseau pieton trop eloigne/
  )
})

test('distance superieure a 4 km refusee', async () => {
  const data = mockResponse()
  data.trip.summary.length = 5

  const provider = createValhallaProvider(async () =>
    new Response(JSON.stringify(data), { status: 200 })
  )

  await assert.rejects(
    provider.walk(from, to),
    GeographicError
  )
})

test('coordonnees invalides refusees sans requete', async () => {
  let calls = 0
  const provider = createValhallaProvider(async () => {
    calls++
    return new Response('{}')
  })

  await assert.rejects(
    provider.walk({ latitude: 999, longitude: 4 }, to),
    GeographicError
  )

  assert.equal(calls, 0)
})
