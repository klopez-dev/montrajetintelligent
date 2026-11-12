import { useEffect, useId, useState } from 'react'
import type { ServiceResult } from '../types/transport'

interface Entity { id: string; name: string }
interface Props<T extends Entity> {
  label: string
  placeholder: string
  selected: T | null
  debounceMs?: number
  manualSearch?: boolean
  disabled?: boolean
  onSelect: (value: T | null) => void
  search: (query: string, signal: AbortSignal) => Promise<ServiceResult<T[]>>
  describe: (entity: T) => string
  queryText?: string
  onQueryChange?: (value: string) => void
}

/** Choix explicite d'un identifiant : un nom seul ne sélectionne jamais un homonyme. */
export function GtfsSearchField<T extends Entity>({ label, placeholder, selected, disabled, onSelect, search, describe, queryText, onQueryChange, debounceMs = 180, manualSearch = false }: Props<T>) {
  const id = useId()
  const [typedQuery, setQuery] = useState('')
  const query = queryText ?? typedQuery
  const [options, setOptions] = useState<T[]>([])
  const [message, setMessage] = useState('')
  const [request, setRequest] = useState<{ query: string } | null>(null)

  useEffect(() => {
    if (selected || disabled || !query.trim()) return
    if (manualSearch && request?.query !== query) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setMessage('Recherche…')
      try {
        const result = await search(query.trim(), controller.signal)
        if (controller.signal.aborted) return
        if (result.status === 'connected') {
          setOptions(result.data)
          setMessage((result.data.length ? `${result.data.length} choix. Sélectionnez le bon identifiant. Affinez votre saisie si nécessaire.` : 'Aucun résultat pour cette recherche.') + (result.warning ? ` ${result.warning}` : ''))
        } else { setOptions([]); setMessage(result.message) }
      } catch { if (!controller.signal.aborted) setMessage('La recherche est indisponible.') }
    }, debounceMs)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, selected, disabled, search, debounceMs, manualSearch, request])

  return <div className="gtfs-search-field">
    <label className="field" htmlFor={id}><span>{label}</span>
      <input id={id} disabled={disabled} placeholder={placeholder} maxLength={80} autoComplete="off"
        aria-describedby={`${id}-hint`} value={selected ? `${selected.name} · ${selected.id}` : query}
        onChange={event => { setRequest(null); setQuery(event.target.value); onQueryChange?.(event.target.value); setOptions([]); setMessage(''); onSelect(null) }}/>
    </label>
    {manualSearch && <button type="button" className="secondary" disabled={disabled || !!selected || query.trim().length < 2} onClick={() => setRequest({ query })}>Rechercher ce lieu</button>}
    <p id={`${id}-hint`} className="search-hint" role="status">{selected ? describe(selected) : message || (disabled ? 'Sélectionnez d’abord une ligne.' : 'Saisissez un nom, un code ou un identifiant.')}</p>
    {!selected && !disabled && options.length > 0 && <ul className="gtfs-options" aria-label={`Résultats : ${label}`}>{options.map(option => <li key={option.id}>
      <button type="button" onClick={() => { onSelect(option); setOptions([]) }}><strong>{option.name}</strong><small>{describe(option)}</small></button>
    </li>)}</ul>}
  </div>
}
