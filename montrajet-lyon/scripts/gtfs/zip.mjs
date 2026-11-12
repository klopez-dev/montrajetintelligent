import { open } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInflateRaw, crc32 } from 'node:zlib'

/** ZIP classique, stocké ou Deflate. Pas d'extraction sur disque, ni de chemin exécuté.
 * ZIP64/chiffrement sont refusés explicitement plutôt que lus partiellement.
 */
export async function openZip(path) {
  const file = await open(path, 'r')
  try {
    const size = (await file.stat()).size
    const tailSize = Math.min(size, 65557)
    const tail = Buffer.alloc(tailSize)
    await file.read(tail, 0, tailSize, size - tailSize)
    let end = -1
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break }
    }
    if (end < 0) throw new Error('Archive ZIP invalide : répertoire absent.')
    const count = tail.readUInt16LE(end + 10)
    const length = tail.readUInt32LE(end + 12)
    const offset = tail.readUInt32LE(end + 16)
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || count === 65535 || offset === 0xffffffff || offset + length > size || length > 10_000_000) {
      throw new Error('ZIP64, archive multi-volume ou répertoire excessif non pris en charge.')
    }
    const directory = Buffer.alloc(length)
    await file.read(directory, 0, length, offset)
    const entries = new Map()
    let cursor = 0
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > length || directory.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Répertoire ZIP tronqué.')
      const flags = directory.readUInt16LE(cursor + 8)
      const method = directory.readUInt16LE(cursor + 10)
      const compressed = directory.readUInt32LE(cursor + 20)
      const uncompressed = directory.readUInt32LE(cursor + 24)
      const nameLength = directory.readUInt16LE(cursor + 28)
      const extraLength = directory.readUInt16LE(cursor + 30)
      const commentLength = directory.readUInt16LE(cursor + 32)
      const localOffset = directory.readUInt32LE(cursor + 42)
      const name = directory.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
      cursor += 46 + nameLength + extraLength + commentLength
      if (cursor > length || flags & 1 || ![0, 8].includes(method) || compressed === 0xffffffff || uncompressed === 0xffffffff || uncompressed > 2_000_000_000) throw new Error(`Entrée ZIP non prise en charge : ${name}`)
      if (name.endsWith('/')) continue
      const basename = name.replaceAll('\\', '/').split('/').at(-1).toLowerCase()
      if (entries.has(basename)) throw new Error(`Fichier ambigu/dupliqué dans le ZIP : ${basename}`)
      const header = Buffer.alloc(30)
      await file.read(header, 0, 30, localOffset)
      if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('En-tête ZIP invalide.')
      const start = localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
      if (start + compressed > offset) throw new Error('Entrée ZIP hors limites.')
      entries.set(basename, { start, compressed, uncompressed, method, crc: directory.readUInt32LE(cursor - 46 - nameLength - extraLength - commentLength + 16) })
    }
    return {
      names: [...entries.keys()],
      async *read(name) {
        const entry = entries.get(name)
        if (!entry) throw new Error(`Fichier absent : ${name}`)
        if (entry.compressed === 0) {
          if (entry.uncompressed !== 0 || entry.crc !== 0) throw new Error(`Entrée ZIP vide invalide : ${name}`)
          return
        }
        const source = createReadStream(path, { start: entry.start, end: entry.start + entry.compressed - 1 })
        const stream = entry.method === 8 ? source.pipe(createInflateRaw()) : source
        source.on('error', error => stream.destroy(error))
        let bytes = 0
        let checksum = 0
        try {
          for await (const chunk of stream) {
            bytes += chunk.length
            if (bytes > entry.uncompressed) throw new Error(`Taille décompressée invalide : ${name}`)
            checksum = crc32(chunk, checksum)
            yield chunk
          }
          if (bytes !== entry.uncompressed || checksum !== entry.crc) throw new Error(`ZIP corrompu (taille/CRC) : ${name}`)
        } finally { source.destroy(); stream.destroy() }
      },
    }
  } finally { await file.close() }
}
