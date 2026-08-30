/** Shared vocabulary between the analysis engine, the worker and the UI. */

export interface SourceFile {
  path: string
  text: string
}

/** Where a declaration lives. `pos` is the offset of its *name*, which is both a
 *  stable identity and the position TypeScript's call-hierarchy APIs expect. */
export interface DeclRef {
  file: string
  pos: number
}

export type TokenClass =
  | 'kw' | 'str' | 'num' | 'com' | 'punc' | 'op'
  | 'call' | 'type' | 'var' | 'prop' | 'param' | 'jsx' | 'text'

export interface Token {
  /** Offset relative to the card's own text. */
  start: number
  length: number
  cls: TokenClass
}

export type LinkRole = 'call' | 'type' | 'ref'

export interface CardLink {
  /** Offset relative to the card's own text. */
  start: number
  length: number
  name: string
  role: LinkRole
  /** Null when the symbol could not be resolved at all. */
  target: DeclRef | null
  /** True when the definition lives outside the loaded project (lib, node_modules). */
  external: boolean
  /** True when the definition is inside this same card — jumping is pointless. */
  local: boolean
}

export interface Card {
  /** `${file}#${pos}` */
  id: string
  file: string
  name: string
  kind: string
  containerName: string | null
  /** Source slice for this declaration, including a leading JSDoc block. */
  text: string
  /** Absolute span of `text` within the file. */
  span: { start: number; length: number }
  /** Absolute position of the declaration's name. */
  pos: number
  /** 1-based line number the card's text starts on. */
  startLine: number
  tokens: Token[]
  links: CardLink[]
}

export interface SymbolHit {
  name: string
  kind: string
  containerName: string | null
  file: string
  pos: number
  /** 'exact' | 'prefix' | 'substring' | 'camelCase' */
  matchKind: string
}

export interface CallerHit {
  name: string
  kind: string
  file: string
  pos: number
  /** How many call sites inside that caller. */
  sites: number
}

export interface ProjectStats {
  fileCount: number
  totalBytes: number
  /** Files that failed to parse or resolve, with a reason. */
  problems: string[]
}
