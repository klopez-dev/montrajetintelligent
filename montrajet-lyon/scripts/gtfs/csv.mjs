/** Lecteur CSV UTF-8 en flux : BOM, CRLF, virgules, guillemets doublés et retours
 * à la ligne dans les champs. Les erreurs ne sont jamais ignorées silencieusement.
 */
export async function* csvRecords(chunks) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let field = '', row = [], quoted = false, afterQuote = false, first = true, skipLf = false
  function* consume(text) {
    for (const c of text) {
      if (first) { first = false; if (c === '\ufeff') continue }
      if (skipLf) { skipLf = false; if (c === '\n') continue }
      if (quoted) {
        if (c === '"') { quoted = false; afterQuote = true } else field += c
      } else if (afterQuote && c === '"') {
        field += '"'; quoted = true; afterQuote = false
      } else if (c === ',') {
        row.push(field); field = ''; afterQuote = false
      } else if (c === '\n' || c === '\r') {
        row.push(field); field = ''; afterQuote = false
        if (row.some(v => v !== '')) yield row
        row = []; skipLf = c === '\r'
      } else if (afterQuote) {
        throw new Error('CSV invalide : caractère après un guillemet fermant.')
      } else if (c === '"') {
        if (field) throw new Error('CSV invalide : guillemet au milieu d’un champ.')
        quoted = true
      } else field += c
      if (field.length > 2_000_000 || row.length > 500) throw new Error('Champ ou ligne CSV excessif.')
    }
  }
  for await (const chunk of chunks) yield* consume(decoder.decode(chunk, { stream: true }))
  yield* consume(decoder.decode())
  if (quoted) throw new Error('CSV invalide : guillemet non fermé.')
  if (field || row.length || afterQuote) { row.push(field); yield row }
}

export async function* csvObjects(chunks, requiredHeaders, filename) {
  let headers
  let line = 0
  for await (const values of csvRecords(chunks)) {
    line++
    if (!headers) {
      headers = values.map(v => v.trim())
      if (new Set(headers).size !== headers.length) throw new Error(`${filename} : colonnes dupliquées.`)
      for (const name of requiredHeaders) if (!headers.includes(name)) throw new Error(`${filename} : colonne obligatoire absente (${name}).`)
    } else {
      if (values.length !== headers.length) throw new Error(`${filename}, enregistrement ${line} : nombre de colonnes incorrect.`)
      yield Object.fromEntries(headers.map((h, i) => [h, values[i].trim()]))
    }
  }
  if (!headers) throw new Error(`${filename} : fichier vide.`)
}
