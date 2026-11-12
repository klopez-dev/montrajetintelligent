import type { AddressPlace } from '../../src/types/mobility.ts'
import type { GeographicTrace } from './provider.ts'

interface PhotonFeature {
  geometry?: {
    type?: string
    coordinates?: number[]
  }
  properties?: {
    osm_id?: number
    osm_type?: string
    type?: string
    name?: string
    street?: string
    housenumber?: string
    postcode?: string
    city?: string
    countrycode?: string
  }
}

interface PhotonResponse {
  features?: PhotonFeature[]
}

export function createPhotonProvider(
  fetcher: typeof fetch = fetch,
  now = () => Date.now()
) {
  const cache = new Map<string, {
    until: number
    value: AddressPlace[]
  }>()

  const addressIds = new Map<string, {
    until: number
    value: AddressPlace
  }>()

  let blockedUntil = 0
  let lastRequest = 0
  let gate: Promise<void> = Promise.resolve()

  async function addresses(
    query: string,
    trace?: GeographicTrace,
    signal?: AbortSignal
  ): Promise<AddressPlace[]> {
    const q = query.trim()

    if (q.length < 3 || q.length > 160) return []

    signal?.throwIfAborted()

    const key = q.toLocaleLowerCase('fr')
    const cached = cache.get(key)

    if (cached && cached.until > now()) {
      if (trace) trace.cacheHits++
      return cached.value
    }

    if (blockedUntil > now()) {
      throw new Error('Photon temporairement indisponible.')
    }

    const url = new URL('https://photon.komoot.io/api/')

    url.search = new URLSearchParams({
      q,
      limit: '6',
      lang: 'fr',
      lat: '45.75',
      lon: '4.85'
    }).toString()

    const previous = gate
    let release!: () => void

    gate = new Promise<void>(resolve => {
      release = resolve
    })

    await previous

    try {
      signal?.throwIfAborted()

      const wait = Math.max(0, 1000 - (now() - lastRequest))

      if (wait > 0) {
        await new Promise(resolve => setTimeout(resolve, wait))
      }

      signal?.throwIfAborted()
      lastRequest = now()

      const started = performance.now()

      try {
        if (trace) trace.upstreamRequests++

        const response = await fetcher(url, {
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
            : AbortSignal.timeout(8000),
          headers: { Accept: 'application/json' },
          redirect: 'error'
        })

        if ([429, 502, 503, 504].includes(response.status)) {
          blockedUntil = now() + 30000
        }

        if (!response.ok) {
          await response.body?.cancel()
          throw new Error(`Photon HTTP ${response.status}`)
        }

        const text = await response.text()

        if (text.length > 1000000) {
          throw new Error('Reponse Photon trop volumineuse.')
        }

        const data = JSON.parse(text) as PhotonResponse

        if (!Array.isArray(data.features)) {
          throw new Error('Reponse Photon invalide.')
        }

        const results: AddressPlace[] = []

        for (const feature of data.features) {
          const p = feature.properties
          const coordinates = feature.geometry?.coordinates

          if (!p || feature.geometry?.type !== 'Point') continue
          if (!Array.isArray(coordinates) || coordinates.length !== 2) continue
          if (!coordinates.every(Number.isFinite)) continue

          const [longitude, latitude] = coordinates

          if (Math.abs(longitude) > 180 || Math.abs(latitude) > 90) continue
          if (p.countrycode?.toLowerCase() !== 'fr') continue

          const street = p.street || p.name
          if (!street) continue

          const number = p.housenumber?.trim()
          const precision = number ? 'housenumber' : 'street'

          const name = [
            number,
            street,
            p.postcode,
            p.city
          ].filter(Boolean).join(' ')

          if (!name.trim()) continue

          const osmType = p.osm_type
          const osmId = p.osm_id

          if (
            !osmType ||
            !Number.isSafeInteger(osmId) ||
            osmId! <= 0
          ) continue

          const id = `address:photon:${osmType}:${osmId}:${number || 'street'}`

          results.push({
            kind: 'address',
            id,
            name,
            longitude,
            latitude,
            precision,
            source: 'OpenStreetMap via Photon'
          })
        }

        const unique = [...new Map(
          results.map(value => [value.id, value])
        ).values()]

        cache.set(key, {
          until: now() + 300000,
          value: unique
        })

        for (const value of unique) {
          addressIds.set(value.id, {
            until: now() + 300000,
            value
          })
        }

        while (cache.size > 256) {
          cache.delete(cache.keys().next().value!)
        }

        while (addressIds.size > 256) {
          addressIds.delete(addressIds.keys().next().value!)
        }

        return unique
      } finally {
        if (trace) {
          trace.geocodingMs += performance.now() - started
        }
      }
    } finally {
      release()
    }
  }

  async function resolveAddress(
    id: string,
    name: string,
    trace?: GeographicTrace,
    signal?: AbortSignal
  ): Promise<AddressPlace | undefined> {
    signal?.throwIfAborted()

    if (!id.startsWith('address:photon:')) return undefined

    const hit = addressIds.get(id)

    if (
      hit &&
      hit.until > now() &&
      hit.value.name === name
    ) {
      if (trace) trace.cacheHits++
      return hit.value
    }

    const results = await addresses(name, trace, signal)

    return results.find(
      value => value.id === id && value.name === name
    )
  }

  return { addresses, resolveAddress }
}