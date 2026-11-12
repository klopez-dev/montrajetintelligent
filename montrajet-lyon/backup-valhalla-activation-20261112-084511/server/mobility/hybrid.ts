import type { GeographicProvider } from './provider.ts'
import { createIgnProvider } from './provider.ts'
import { createPhotonProvider } from './photon.ts'

export function createHybridGeographicProvider(): GeographicProvider {
  const ign = createIgnProvider()
  const photon = createPhotonProvider()
  return {
    addresses: (q, trace, signal) => photon.addresses(q, trace, signal),
    walk: (from, to, trace, signal) => ign.walk(from, to, trace, signal),
    resolveAddress: async (id, name, trace, signal) =>
      id.startsWith('address:photon:')
        ? photon.resolveAddress(id, name, trace, signal)
        : id.startsWith('address:')
          ? ign.resolveAddress?.(id, name, trace, signal)
          : Promise.resolve(undefined)
  }
}