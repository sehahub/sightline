import type { Card, CallerHit, SourceFile, SymbolHit } from '../engine/types'

/**
 * The worker's surface, written as a function map so the request payload and
 * response type of every operation stay tied together on both sides.
 */
export interface Ops {
  load: (p: { files: SourceFile[]; libsUrl: string }) => { files: string[] }
  search: (p: { query: string }) => SymbolHit[]
  outline: (p: { file: string }) => SymbolHit[]
  card: (p: { file: string; pos: number }) => Card | null
  callers: (p: { file: string; pos: number }) => CallerHit[]
  quickInfo: (p: { file: string; pos: number }) => string | null
}

export type Op = keyof Ops
export type Params<K extends Op> = Parameters<Ops[K]>[0]
export type Result<K extends Op> = ReturnType<Ops[K]>

export interface Request<K extends Op = Op> {
  id: number
  op: K
  params: Params<K>
}

export type Response =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
