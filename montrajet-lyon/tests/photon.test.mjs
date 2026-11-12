import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhotonProvider } from '../server/mobility/photon.ts'

const feature = (overrides = {}) => ({
  type: 'Feature',
  geometry: {
    type: 'Point',
    coordinates: [4.8782357, 45.7488478]
  },
  properties: {
    osm_id: 123456,
    osm_type: 'N',
    type: 'house',
    name: 'Avenue Lacassagne',
    street: 'Avenue Lacassagne',
    housenumber: '135',
    postcode: '69003',
    city: 'Lyon',
    countrycode: 'FR'
  },
  ...overrides
})

const response = features =>
  Response.json({ type: 'FeatureCollection', features })

test('Photon : adresse avec numero', async () => {
  const provider = createPhotonProvider(
    async () => response([feature()])
  )

  const results = await provider.addresses('135 avenue Lacassagne Lyon')

  assert.equal(results.length, 1)
  assert.equal(results[0].precision, 'housenumber')
  assert.equal(results[0].source, 'OpenStreetMap via Photon')
  assert.equal(results[0].latitude, 45.7488478)
  assert.equal(results[0].longitude, 4.8782357)
  assert.match(results[0].id, /^address:photon:/)
})

test('Photon : rue sans numero', async () => {
  const provider = createPhotonProvider(
    async () => response([
      feature({
        properties: {
          ...feature().properties,
          housenumber: undefined
        }
      })
    ])
  )

  const results = await provider.addresses('avenue Lacassagne Lyon')

  assert.equal(results[0].precision, 'street')
})

test('Photon : coordonnees invalides rejetees', async () => {
  const provider = createPhotonProvider(
    async () => response([
      feature({
        geometry: {
          type: 'Point',
          coordinates: [200, 95]
        }
      })
    ])
  )

  assert.deepEqual(
    await provider.addresses('135 avenue Lacassagne Lyon'),
    []
  )
})

test('Photon : adresse hors France rejetee', async () => {
  const provider = createPhotonProvider(
    async () => response([
      feature({
        properties: {
          ...feature().properties,
          countrycode: 'DE'
        }
      })
    ])
  )

  assert.deepEqual(
    await provider.addresses('135 avenue Lacassagne Lyon'),
    []
  )
})

test('Photon : suppression des doublons', async () => {
  const provider = createPhotonProvider(
    async () => response([feature(), feature()])
  )

  const results = await provider.addresses('135 avenue Lacassagne Lyon')

  assert.equal(results.length, 1)
})

test('Photon : resolution par identifiant et cache', async () => {
  let calls = 0

  const provider = createPhotonProvider(async () => {
    calls++
    return response([feature()])
  })

  const results = await provider.addresses('135 avenue Lacassagne Lyon')
  const address = results[0]

  const resolved = await provider.resolveAddress(
    address.id,
    address.name
  )

  assert.deepEqual(resolved, address)

  const cached = await provider.addresses('135 avenue Lacassagne Lyon')

  assert.deepEqual(cached, results)
  assert.equal(calls, 1)
})

test('Photon : erreur HTTP 504', async () => {
  const provider = createPhotonProvider(
    async () => new Response('', { status: 504 })
  )

  await assert.rejects(
    () => provider.addresses('135 avenue Lacassagne Lyon'),
    /Photon HTTP 504/
  )
})