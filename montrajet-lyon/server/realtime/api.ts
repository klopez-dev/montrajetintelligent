import type { QueryDatabase } from '../gtfs/repository.ts'
import type { GrandLyonClient } from './client.ts'
import { mapStopPassages } from './mapping.ts'
import type { RealtimeResult } from '../../src/types/realtime.ts'
import type { GrandLyonConfig } from './config.ts'

const messages: Record<string, string> = {
  configuration_invalid: 'La configuration serveur du temps réel est invalide. Les horaires GTFS restent disponibles.',
  authentication_required: 'Temps réel indisponible : l’accès officiel Grand Lyon nécessite une authentification serveur non configurée.',
  access_denied: 'La source officielle refuse l’accès au temps réel. Les horaires théoriques restent disponibles.',
  policy_unconfirmed: 'Le temps réel est en attente de validation des conditions d’utilisation et de fréquence de la source.',
  mapping_unconfirmed: 'Le temps réel est en attente de vérification des identifiants officiels des lignes, courses et quais.',
  cooldown: 'Aucune estimation récente en cache pour cet arrêt. Une nouvelle demande à la source n’est pas encore autorisée.',
  no_estimates: 'Aucune estimation temps réel fiable n’est disponible pour cette ligne et ce quai.',
  stale: 'Les estimations reçues sont périmées ou non vérifiables ; elles ne sont pas affichées.',
  timeout: 'La source temps réel ne répond pas dans le délai prévu. Les horaires théoriques sont conservés.',
  validation_budget_exhausted: 'Mode de validation local : la consultation fournisseur unique est terminée. Les horaires GTFS restent disponibles.',
  rate_limited: 'Data Grand Lyon limite temporairement les requêtes (HTTP 429). Les horaires GTFS restent disponibles.',
  provider_unavailable: 'Data Grand Lyon est indisponible ou le réseau ne répond pas. Les horaires GTFS restent disponibles.',
  invalid_response: 'La réponse Data Grand Lyon est invalide. Les horaires GTFS restent disponibles.',
  incomplete_response: 'La réponse Data Grand Lyon est incomplète. Les horaires GTFS restent disponibles.',
}
export async function realtimePassages(db: QueryDatabase, client: GrandLyonClient, lineId: string, stopId: string, maxAgeMs: number, now = Date.now()): Promise<RealtimeResult> {
  const provider = await client.get(stopId)
  const base = { checkedAt: new Date(provider.checkedAt).toISOString(), fetchedAt: provider.snapshot ? new Date(provider.snapshot.fetchedAt).toISOString() : null, sourceUpdatedAt: null, estimates: [], mapping: null }
  if (!provider.snapshot) return { ...base, state: 'unavailable', reason: provider.reason, message: messages[provider.reason] || 'La source temps réel est indisponible. Les horaires théoriques restent disponibles.' }
  const eligible = provider.snapshot.rows.filter(row => row.id === stopId && row.ligne === lineId)
  // Limite de travail bornée : au plus 24 requêtes de jointure dans une invocation D1.
  if (eligible.length > 24) return { ...base, state: 'unavailable', reason: 'mapping_budget', message: 'Trop de passages pour une vérification fiable ; les horaires théoriques sont conservés.' }
  const mapped = await mapStopPassages(db, eligible, lineId, stopId, Math.max(now, provider.checkedAt), maxAgeMs)
  const latest = mapped.estimates.map(row => row.sourceUpdatedAt).sort().at(-1) || null
  const state = mapped.estimates.length ? 'available' : eligible.length ? 'stale' : 'no_estimates'
  return { ...base, state, reason: mapped.estimates.length ? provider.reason : state, sourceUpdatedAt: latest, estimates: mapped.estimates,
    mapping: mapped.statistics, message: mapped.estimates.length ? ['fetched', 'cached'].includes(provider.reason) ? 'Passages officiels Data Grand Lyon, vérifiés par identifiants exacts.' : 'La source est actuellement indisponible ou non vérifiable. Ses derniers passages encore frais sont conservés jusqu’à expiration.' : messages[state] }
}

export async function handleRealtimeRequest(request: Request, db: QueryDatabase | null, client: GrandLyonClient, maxAgeMs: number, config?: GrandLyonConfig): Promise<Response> {
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } })
  if (request.method !== 'GET') return json({ error: 'Méthode non autorisée.' }, 405)
  const url = new URL(request.url)
  if (url.pathname === '/api/realtime/status') {
    const reason = !config?.username || !config.password ? 'authentication_required' : config.localValidationOnce ? 'local_validation_once' : !config.policyConfirmed ? 'policy_unconfirmed' : !config.stopPassagesConfirmed ? 'mapping_unconfirmed' : 'configured'
    return json({ state: ['configured', 'local_validation_once'].includes(reason) ? 'ready_to_query' : 'disabled', reason, validationMode: config?.localValidationOnce === true, itineraryEnrichment: 'disabled', itineraryReason: config?.mappingConfirmed ? 'algorithm_not_connected' : 'mapping_unconfirmed', source: 'Data Grand Lyon', checkedAt: new Date().toISOString(), automaticRefresh: false })
  }
  if (url.pathname !== '/api/realtime/passages') return json({ error: 'Ressource inconnue.' }, 404)
  const lineId = url.searchParams.get('lineId')?.trim(), stopId = url.searchParams.get('stopId')?.trim()
  if (!lineId || !stopId || lineId.length > 200 || stopId.length > 200) return json({ error: 'Sélectionnez une ligne et un arrêt valides.' }, 400)
  if (!db) return json({ error: 'Catalogue GTFS indisponible pour vérifier les identifiants.' }, 503)
  try {
    const [stop] = await db.all('SELECT 1 FROM route_stops WHERE route_id=? AND stop_id=?', [lineId, stopId])
    if (!stop) return json({ error: 'Ce quai n’est pas relié à cette ligne dans le GTFS.' }, 400)
    return json({ ...await realtimePassages(db, client, lineId, stopId, maxAgeMs), validationMode: config?.localValidationOnce === true })
  } catch {
    return json({ error: 'La vérification du temps réel est indisponible. Les horaires GTFS sont conservés.' }, 503)
  }
}
