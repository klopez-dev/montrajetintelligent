/** No arbitrary URL or secret in the browser. Only reviewed providers are selectable. */
export function mapProvider(value:unknown):'osm'|'none' { return value==='none'?'none':'osm' }
export const osmTiles='https://tile.openstreetmap.org/{z}/{x}/{y}.png'
