/** Strict pointer contract for the static preproduction; no legacy fallback. */
export function parseVersionPointer(bytes:Uint8Array):{schema:2;manifestSha256:string;feedSha256:string}{
 let value:unknown
 try{value=JSON.parse(new TextDecoder().decode(bytes))}catch{throw new Error('Pointeur GTFS illisible')}
 const p=value as {schema?:unknown;manifestSha256?:unknown;feedSha256?:unknown}|null
 if(!p||p.schema!==2||typeof p.manifestSha256!=='string'||typeof p.feedSha256!=='string'||!/^[a-f0-9]{64}$/.test(p.manifestSha256)||!/^[a-f0-9]{64}$/.test(p.feedSha256))throw new Error('Version GTFS incompatible')
 return {schema:2,manifestSha256:p.manifestSha256,feedSha256:p.feedSha256}
}
