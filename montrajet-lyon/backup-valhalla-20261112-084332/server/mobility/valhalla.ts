import type { Point, WalkPath } from '../../src/types/mobility.ts'
import { distance, GeographicError } from './provider.ts'
import type { GeographicTrace } from './provider.ts'

const endpoint = 'https://valhalla1.openstreetmap.de/route'

interface ValhallaResponse {
  trip?: {
    summary?: { length?: number; time?: number }
    legs?: { shape?: string }[]
  }
}

function decodePolyline6(encoded: string): [number, number][] {
  const coordinates: [number, number][] = []
  let index = 0
  let latitude = 0
  let longitude = 0

  while (index < encoded.length) {
    const values: number[] = []

    for (let axis = 0; axis < 2; axis++) {
      let shift = 0
      let result = 0
      let byte: number

      do {
        if (index >= encoded.length || shift > 30) {
          throw new GeographicError('Geometrie Valhalla invalide.')
        }

        byte = encoded.charCodeAt(index++) - 63

        if (byte < 0 || byte > 63) {
          throw new GeographicError('Geometrie Valhalla invalide.')
        }

        result += (byte & 31) * 2 ** shift
        shift += 5
      } while (byte >= 32)

      values.push(result % 2 === 1
        ? -(Math.floor(result / 2) + 1)
        : result / 2)
    }

    latitude += values[0]
    longitude += values[1]

    const lat = latitude / 1e6
    const lon = longitude / 1e6

    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new GeographicError('Coordonnees Valhalla invalides.')
    }

    coordinates.push([lon, lat])

    if (coordinates.length > 20000) {
      throw new GeographicError('Geometrie Valhalla trop longue.')
    }
  }

  if (coordinates.length < 2) {
    throw new GeographicError('Parcours Valhalla incomplet.')
  }

  return coordinates
}

export function createValhallaProvider(
  fetcher: typeof fetch = fetch,
  now = () => Date.now()
) {
  const cache = new Map<string, { until: number; value: WalkPath }>()
  let gate: Promise<void> = Promise.resolve()
  let lastRequest = 0
  let blockedUntil = 0

  async function walk(
    from: Point,
    to: Point,
    trace?: GeographicTrace,
    signal?: AbortSignal
  ): Promise<WalkPath> {
    signal?.throwIfAborted()

    for (const point of [from, to]) {
      if (!Number.isFinite(point.latitude) ||
          !Number.isFinite(point.longitude) ||
          Math.abs(point.latitude) > 90 ||
          Math.abs(point.longitude) > 180) {
        throw new GeographicError('Coordonnees pietonnes invalides.')
      }
    }

    const key = JSON.stringify([from, to])
    const hit = cache.get(key)

    if (hit && hit.until > now()) {
      if (trace) trace.cacheHits++
      return hit.value
    }

    if (blockedUntil > now()) {
      throw new GeographicError('Valhalla temporairement indisponible.')
    }

    const previous = gate
    let release!: () => void
    gate = new Promise<void>(resolve => { release = resolve })

    const queuedAt = performance.now()

    try {
      await previous
      if (trace) trace.queueMs += performance.now() - queuedAt

      signal?.throwIfAborted()

      if (blockedUntil > now()) {
        throw new GeographicError('Valhalla temporairement indisponible.')
      }

      const delay = Math.max(0, 1100 - (now() - lastRequest))

      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay))
      }

      signal?.throwIfAborted()
      lastRequest = now()

      const started = performance.now()

      try {
        const body = JSON.stringify({
          locations: [
            { lat: from.latitude, lon: from.longitude },
            { lat: to.latitude, lon: to.longitude }
          ],
          costing: 'pedestrian',
          units: 'kilometers',
          shape_format: 'polyline6'
        })

        if (trace) trace.upstreamRequests++

        const response = await fetcher(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Client-Id': 'montrajet-lyon-local-dev'
          },
          body,
          redirect: 'error',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
            : AbortSignal.timeout(8000)
        })

        if ([429, 502, 503, 504].includes(response.status)) {
          blockedUntil = now() + 30000
        }

        if (!response.ok) {
          await response.body?.cancel()
          throw new GeographicError(`Valhalla HTTP ${response.status}.`)
        }

        const raw = await response.text()

        if (raw.length > 1000000) {
          throw new GeographicError('Reponse Valhalla trop volumineuse.')
        }

        let data: ValhallaResponse

        try {
          data = JSON.parse(raw) as ValhallaResponse
        } catch {
          throw new GeographicError('Reponse Valhalla invalide.')
        }

        const summary = data.trip?.summary
        const legs = data.trip?.legs

        if (!summary || !Array.isArray(legs) ||
            legs.length !== 1 || typeof legs[0].shape !== 'string') {
          throw new GeographicError('Parcours Valhalla incomplet.')
        }

        const meters = (summary.length ?? NaN) * 1000
        const seconds = summary.time ?? NaN

        if (!Number.isFinite(meters) || meters <= 0 || meters > 4000 ||
            !Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) {
          throw new GeographicError('Distance ou duree Valhalla invalide.')
        }

        const coordinates = decodePolyline6(legs[0].shape)
        const first = coordinates[0]
        const last = coordinates[coordinates.length - 1]

        const startSnapMeters = distance(from, {
          longitude: first[0], latitude: first[1]
        })

        const endSnapMeters = distance(to, {
          longitude: last[0], latitude: last[1]
        })

        if (startSnapMeters > 25 || endSnapMeters > 25) {
          throw new GeographicError(
            'Acces au reseau pieton trop eloigne ; parcours exclu.'
          )
        }

        const result: WalkPath = {
          source: 'Valhalla / OpenStreetMap' as WalkPath['source'],
          profile: 'pedestrian',
          resourceVersion: 'OpenStreetMap',
          fetchedAt: new Date(now()).toISOString(),
          durationSeconds: Math.ceil(seconds),
          distanceMeters: meters,
          startSnapMeters,
          endSnapMeters,
          geometry: { type: 'LineString', coordinates }
        }

        signal?.throwIfAborted()

        if (cache.size >= 256) {
          cache.delete(cache.keys().next().value!)
        }

        cache.set(key, { until: now() + 3600000, value: result })

        return result
      } catch (error) {
        signal?.throwIfAborted()
        if (error instanceof GeographicError) throw error
        throw new GeographicError(
          'Service Valhalla inaccessible. Aucun parcours invente.'
        )
      } finally {
        if (trace) trace.walkingMs += performance.now() - started
      }
    } finally {
      release()
    }
  }

  return { walk }
}