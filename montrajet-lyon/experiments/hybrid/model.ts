import type { FeedMetadata } from '../../src/types/gtfs.ts'
export interface Catalog {
  metadata: FeedMetadata
  stops: Record<string,unknown>[]
  routes: Record<string,unknown>[]
  memberships: Record<string,unknown>[]
  transfers: Record<string,unknown>[]
  trips: [string,string,string,string,string][]
  headsigns: string[]
}
export interface Asset { file:string; sha256:string; bytes:number; rawBytes:number; records?:number; trips?:Asset }
export interface Manifest { format:1|2; feedSha256:string; catalog:Asset; days:Record<string,Asset>; note:string }
