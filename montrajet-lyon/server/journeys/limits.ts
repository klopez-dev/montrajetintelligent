export interface RoutingLimits {
  maxEvents: number
  maxLabels: number
  maxLabelsPerStop: number
  maxBoardStops: number
  maxWalkRequests: number
  maxAccessSeconds: number
  radiusMeters: number
  deadlineMs: number
}
export const defaultRoutingLimits: RoutingLimits = { maxEvents: 240000, maxLabels: 50000, maxLabelsPerStop: 64, maxBoardStops: 1600, maxWalkRequests: 48, maxAccessSeconds: 1200, radiusMeters: 1200, deadlineMs: 45000 }
export function routingLimits(env: Record<string, unknown> = {}): RoutingLimits {
  const result = { ...defaultRoutingLimits }
  for (const key of Object.keys(result) as (keyof RoutingLimits)[]) {
    const name = 'ROUTING_' + key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase()).toUpperCase()
    if (env[name] !== undefined) {
      const value = Number(env[name])
      if (!Number.isInteger(value) || value < 1 || value > defaultRoutingLimits[key] * 4) throw new Error(`Configuration ${name} invalide.`)
      result[key] = value
    }
  }
  return result
}
