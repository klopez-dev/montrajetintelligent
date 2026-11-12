import { parse } from 'parse5'
import type { DefaultTreeAdapterMap } from 'parse5'
import type { TrafficIncident, TrafficMode } from '../../src/types/traffic.ts'
import { parsePeriod, temporalStatus } from './time.ts'

type Node = DefaultTreeAdapterMap['node']
const children = (n: Node): Node[] => 'childNodes' in n ? n.childNodes : []
export const attr = (n: Node, name: string): string => 'attrs' in n ? n.attrs.find(a => a.name === name)?.value || '' : ''
export const hasClass = (n: Node, name: string) => attr(n, 'class').split(/\s+/).includes(name)
export function find(n: Node, test: (n: Node) => boolean): Node[] { return [...(test(n) ? [n] : []), ...children(n).flatMap(child => find(child, test))] }
function text(n: Node): string {
  if (n.nodeName === '#text') return (n as DefaultTreeAdapterMap['textNode']).value
  if (['script', 'style', 'noscript'].includes(n.nodeName)) return ''
  if (n.nodeName === 'br') return '\n'
  return children(n).map(text).join('') + (['p', 'li'].includes(n.nodeName) ? '\n' : '')
}
export const clean = (n: Node) => text(n).split('\n').map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
export const priorities: { line: string; mode: TrafficMode }[] = [
  { line: 'C13', mode: 'bus' }, { line: 'C9', mode: 'bus' }, { line: 'C16', mode: 'bus' }, { line: '125', mode: 'bus' }, { line: 'T3', mode: 'tram' }, { line: 'A', mode: 'metro' }, { line: 'D', mode: 'metro' },
]
export function officialUrl(value: string, base = 'https://www.tcl.fr'): string {
  const url = new URL(value, base)
  if (url.origin !== 'https://www.tcl.fr' || url.username || url.password || url.hash.length > 200) throw new Error('Lien TCL non autorisé.')
  return url.href
}
export function linePages(html: string) {
  const document = parse(html), pages = new Map<string, string>()
  for (const node of find(document, n => n.nodeName === 'a' && hasClass(n, 'trafic-line'))) {
    const url = new URL(officialUrl(attr(node, 'href')))
    const match = /^\/se-deplacer\/infos-trafic-accessibilite\/trafic\/line:SYTNEX:([A-Za-z0-9]+)$/.exec(decodeURIComponent(url.pathname))
    if (match && priorities.some(p => p.line === match[1])) pages.set(match[1], url.href)
  }
  if (!find(document, n => hasClass(n, 'info-trafic_category')).length) throw new Error('Structure de la page trafic TCL non reconnue.')
  return pages
}
/** Inventory is free of additional network requests. Only explicit labelled links qualify. */
export function discoverLinePages(html: string) {
  const document = parse(html)
  linePages(html) // Validate the known index structure, including an explicitly empty index.
  const pages = new Map<string, { line: string; mode: TrafficMode; url: string; announcedCount?: number }>()
  for (const node of find(document, n => n.nodeName === 'a' && hasClass(n, 'trafic-line'))) {
    const url = new URL(officialUrl(attr(node, 'href')))
    const match = /^\/se-deplacer\/infos-trafic-accessibilite\/trafic\/line:SYTNEX:([A-Za-z0-9]+)$/.exec(decodeURIComponent(url.pathname))
    if (!match) continue
    const label = clean(find(node, n => hasClass(n, 'tcl-line-pictogram_label'))[0] || node).split('\n')[0]
    const mode: TrafficMode | undefined = /^Métro /.test(label) ? 'metro' : /^Tramway /.test(label) ? 'tram' : /^Funiculaire /.test(label) ? 'funicular' : /^(Bus |Junior Direct |Pleine Lune |Relais Bus )/.test(label) ? 'bus' : undefined
    const count = /\bVoir (\d+) infos? trafic\b/.exec(clean(node))
    if (mode && label.endsWith(' ' + match[1])) pages.set(match[1], { line: match[1], mode, url: url.href, ...(count ? { announcedCount: Number(count[1]) } : {}) })
  }
  return pages
}
export async function parseLine(html: string, sourceUrl: string, line: string, mode: TrafficMode, fetchedAt: string): Promise<TrafficIncident[]> {
  officialUrl(sourceUrl)
  const document = parse(html), main = find(document, n => hasClass(n, 'alert-detail-page'))[0]
  if (!main || clean(find(main, n => n.nodeName === 'h1')[0] || main).trim() !== `État du trafic de la ligne ${line}` || find(main, n => hasClass(n, 'alert-list')).length !== 1) throw new Error(`Fiche TCL ${line} non reconnue.`)
  const cards = find(main, n => hasClass(n, 'alert_content'))
  if (cards.length > 100) throw new Error('Trop d’annonces TCL.')
  const listText = clean(find(main, n => hasClass(n, 'alert-list'))[0])
  if (!cards.length && !/^(?:Trafic normal|Aucune perturbation(?: en cours)?|Aucune information trafic)[.!]?$/i.test(listText)) throw new Error(`Liste vide TCL ${line} non confirmée.`)
  return Promise.all(cards.map(async card => {
    const paragraphs = find(card, n => n.nodeName === 'p' && !hasClass(n, 'alert_period'))
    const values = paragraphs.map(clean).filter(Boolean)
    if (values.length < 2) throw new Error('Annonce TCL incomplète.')
    const periodText = clean(find(card, n => hasClass(n, 'alert_period'))[0] || { nodeName: '#text', value: '' } as DefaultTreeAdapterMap['textNode']).replace(/\s+/g, ' ')
    const description = values.slice(1).join('\n\n'), title = values[1]
    if (description.length > 30000 || title.length > 2000) throw new Error('Annonce TCL trop volumineuse.')
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${description}\n${periodText}\n${values[0]}`))
    const id = 'tcl-html:' + [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
    const relatedUrls = [...new Set(find(card, n => n.nodeName === 'a').flatMap(n => { try { return [officialUrl(attr(n, 'href'), sourceUrl)] } catch { return [] } }))]
    const explicitDetails: NonNullable<TrafficIncident['explicitDetails']> = []
    for (const value of values.slice(1)) {
      for (const [kind, expression] of Object.entries({ direction: /\ben direction de\b/i, unserved: /non desservi|ne (?:sera|seront) pas desservi/i, relocated: /(?:arrêt|station).*reporté|déplacé/i, replacement: /arrêt.*remplacement|bus relais|arrêt.*report/i, diversion: /dévié|déviation/i, frequency: /toutes les \d+ minutes|fréquence/i })) {
        if (expression.test(value)) explicitDetails.push({ kind: kind as NonNullable<TrafficIncident['explicitDetails']>[number]['kind'], text: value })
      }
    }
    const incident: TrafficIncident = { id, identity: 'content-derived', producer: { id: 'sytral-tcl', name: 'SYTRAL Mobilités · TCL Relation Usagers' }, sourceUrl, relatedUrls, fetchedAt, title, description, type: 'other', officialSeverity: values[0], lines: [{ sourceId: `line:SYTNEX:${line}`, namespace: 'tcl-web', label: line, mode, gtfsIds: [], precision: 'unmatched' }], ...parsePeriod(periodText, title), explicitDetails, recurrenceText: /\bLe \d.*(?: et |,)/.test(title) ? title : undefined, periodText: periodText || undefined, status: 'undetermined', mapping: 'unmatched' }
    incident.status = temporalStatus(incident, Date.parse(fetchedAt))
    return incident
  }))
}
