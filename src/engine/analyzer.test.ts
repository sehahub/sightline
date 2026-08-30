import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Analyzer, SUPPORTING_FILES, rankHits } from './analyzer'
import type { SourceFile, SymbolHit } from './types'

const MATH = `/** Adds two numbers. */
export function add(a: number, b: number): number {
  return a + b
}

export function double(n: number): number {
  return add(n, n)
}
`

const SHAPES = `export interface Point {
  x: number
  y: number
}

export class Grid {
  private cells: Point[] = []

  /** Places a point on the grid. */
  place(p: Point): void {
    this.cells.push(p)
  }

  count(): number {
    return this.cells.length
  }
}
`

const MAIN = `import { double } from './math'
import { Grid, type Point } from './shapes'

export const scale = (p: Point, k: number): Point => {
  const factor = double(k)
  return { x: p.x * factor, y: p.y * factor }
}

export function run(): number {
  const g = new Grid()
  g.place(scale({ x: 1, y: 2 }, 3))
  return g.count()
}
`

const FILES: SourceFile[] = [
  { path: '/src/math.ts', text: MATH },
  { path: '/src/shapes.ts', text: SHAPES },
  { path: '/src/main.ts', text: MAIN },
]

const analyzer = () => new Analyzer(FILES)

/** Offset of the declared name, which is how cards are addressed. */
function at(text: string, needle: string, name: string): number {
  const i = text.indexOf(needle)
  if (i < 0) throw new Error(`fixture missing: ${needle}`)
  const j = text.indexOf(name, i)
  if (j < 0) throw new Error(`name missing: ${name}`)
  return j
}

describe('project loading', () => {
  it('resolves relative imports across files', () => {
    const a = analyzer()
    const diags = a.program.getSemanticDiagnostics(a.program.getSourceFile('/src/main.ts'))
    const unresolved = diags.filter((d) => d.code === 2307) // cannot find module
    expect(unresolved).toEqual([])
  })

  it('lists loaded paths', () => {
    expect(analyzer().paths().sort()).toEqual(['/src/main.ts', '/src/math.ts', '/src/shapes.ts'])
  })
})

describe('outline', () => {
  it('finds top-level and nested declarations', () => {
    const names = analyzer().outline('/src/shapes.ts').map((s) => `${s.kind} ${s.name}`)
    expect(names).toContain('interface Point')
    expect(names).toContain('class Grid')
    expect(names).toContain('method place')
    expect(names).toContain('method count')
  })

  it('reports the enclosing class as container', () => {
    const place = analyzer().outline('/src/shapes.ts').find((s) => s.name === 'place')
    expect(place?.containerName).toBe('Grid')
  })

  it('treats an arrow function assigned to a const as a function', () => {
    const scale = analyzer().outline('/src/main.ts').find((s) => s.name === 'scale')
    expect(scale?.kind).toBe('function')
  })
})

describe('search', () => {
  it('finds symbols by fuzzy name', () => {
    const hits = analyzer().search('doub')
    expect(hits.map((h) => h.name)).toContain('double')
  })

  it('returns nothing for a blank query', () => {
    expect(analyzer().search('   ')).toEqual([])
  })
})

describe('rankHits', () => {
  const hit = (name: string, kind: string, matchKind = 'exact'): SymbolHit =>
    ({ name, kind, containerName: null, file: '/a.ts', pos: 0, matchKind })

  it('puts declarations ahead of properties that merely share the name', () => {
    const ranked = rankHits([hit('parse', 'property'), hit('parse', 'function')])
    expect(ranked.map((h) => h.kind)).toEqual(['function', 'property'])
  })

  it('puts a type declaration first of all', () => {
    const ranked = rankHits([hit('P', 'variable'), hit('P', 'function'), hit('P', 'interface')])
    expect(ranked.map((h) => h.kind)).toEqual(['interface', 'function', 'variable'])
  })

  it('ranks match quality above declaration kind', () => {
    const ranked = rankHits([hit('parser', 'interface', 'substring'), hit('parse', 'property', 'exact')])
    expect(ranked[0].name).toBe('parse')
  })

  it('prefers the shorter name when everything else ties', () => {
    const ranked = rankHits([hit('parseVeryLongThing', 'function'), hit('parse', 'function')])
    expect(ranked[0].name).toBe('parse')
  })

  it('is stable for an unknown kind rather than dropping it', () => {
    expect(rankHits([hit('x', 'something-new')])).toHaveLength(1)
  })

  it('puts the implementation ahead of tests and benchmarks that share the name', () => {
    const at = (file: string): SymbolHit => ({ ...hit('parse', 'function'), file })
    const ranked = rankHits([
      at('/packages/bench/parse.ts'),
      at('/src/core/parse.test.ts'),
      at('/src/core/parse.ts'),
      at('/tests/parse.ts'),
    ])
    expect(ranked[0].file).toBe('/src/core/parse.ts')
    expect(ranked.slice(1).every((h) => SUPPORTING_FILES.test(h.file))).toBe(true)
  })

  it('does not mistake ordinary names for test paths', () => {
    for (const file of ['/src/latest/x.ts', '/src/contest.ts', '/src/benchmarking.ts']) {
      expect(SUPPORTING_FILES.test(file)).toBe(false)
    }
  })
})

describe('card', () => {
  it('captures the whole declaration with its JSDoc', () => {
    const card = analyzer().card('/src/math.ts', at(MATH, 'export function add', 'add'))!
    expect(card.name).toBe('add')
    expect(card.kind).toBe('function')
    expect(card.text.startsWith('/** Adds two numbers. */')).toBe(true)
    expect(card.text.trimEnd().endsWith('}')).toBe(true)
  })

  it('reports the line the card starts on', () => {
    const card = analyzer().card('/src/math.ts', at(MATH, 'export function double', 'double'))!
    expect(card.startLine).toBe(MATH.slice(0, MATH.indexOf('export function double')).split('\n').length)
  })

  it('builds a card for a whole const arrow function', () => {
    const card = analyzer().card('/src/main.ts', at(MAIN, 'export const scale', 'scale'))!
    expect(card.kind).toBe('function')
    expect(card.text.startsWith('export const scale')).toBe(true)
  })

  it('builds a card for a class method with its container', () => {
    const card = analyzer().card('/src/shapes.ts', at(SHAPES, '  place(p: Point)', 'place'))!
    expect(card.kind).toBe('method')
    expect(card.containerName).toBe('Grid')
    expect(card.text).toContain('this.cells.push(p)')
  })

  it('produces highlight tokens', () => {
    const card = analyzer().card('/src/math.ts', at(MATH, 'export function add', 'add'))!
    const classes = new Set(card.tokens.map((t) => t.cls))
    expect(classes.has('kw')).toBe(true)
    expect(card.tokens.every((t) => t.start >= 0 && t.start + t.length <= card.text.length)).toBe(true)
  })

  it('returns null outside any declaration', () => {
    expect(analyzer().card('/src/math.ts', 0)).toBeNull()
  })
})

describe('links', () => {
  const scaleCard = () => analyzer().card('/src/main.ts', at(MAIN, 'export const scale', 'scale'))!

  it('resolves a call to an imported function to its real declaration, not the import alias', () => {
    const link = scaleCard().links.find((l) => l.name === 'double' && l.role === 'call')
    expect(link).toBeDefined()
    expect(link!.target).toEqual({ file: '/src/math.ts', pos: at(MATH, 'export function double', 'double') })
  })

  it('resolves an imported type to its declaration', () => {
    const link = scaleCard().links.find((l) => l.name === 'Point' && l.role === 'type')
    expect(link!.target).toEqual({ file: '/src/shapes.ts', pos: at(SHAPES, 'export interface Point', 'Point') })
  })

  it('resolves a method call through the receiver type', () => {
    const card = analyzer().card('/src/main.ts', at(MAIN, 'export function run', 'run'))!
    const place = card.links.find((l) => l.name === 'place')
    expect(place?.role).toBe('call')
    expect(place?.target).toEqual({ file: '/src/shapes.ts', pos: at(SHAPES, '  place(p: Point)', 'place') })
  })

  it('resolves a constructor call to the class', () => {
    const card = analyzer().card('/src/main.ts', at(MAIN, 'export function run', 'run'))!
    const grid = card.links.find((l) => l.name === 'Grid')
    expect(grid?.target).toEqual({ file: '/src/shapes.ts', pos: at(SHAPES, 'export class Grid', 'Grid') })
  })

  it('keeps link offsets inside the card text and aligned to the identifier', () => {
    const card = scaleCard()
    for (const l of card.links) {
      expect(card.text.slice(l.start, l.start + l.length)).toBe(l.name)
    }
  })

  it('drops plain reads of local variables', () => {
    // `factor` is declared and read inside `scale`; linking it navigates nowhere useful.
    expect(scaleCard().links.some((l) => l.name === 'factor' && l.role === 'ref')).toBe(false)
  })

  it('marks calls into the standard library as external', () => {
    const card = analyzer().card('/src/shapes.ts', at(SHAPES, '  place(p: Point)', 'place'))!
    const push = card.links.find((l) => l.name === 'push')
    expect(push?.external).toBe(true)
    expect(push?.target).toBeNull()
  })
})

describe('callers', () => {
  it('finds callers in another file', () => {
    const hits = analyzer().callers('/src/math.ts', at(MATH, 'export function add', 'add'))
    expect(hits.map((h) => h.name)).toContain('double')
  })

  it('finds callers of a method', () => {
    const hits = analyzer().callers('/src/shapes.ts', at(SHAPES, '  place(p: Point)', 'place'))
    expect(hits.map((h) => h.name)).toContain('run')
  })

  it('counts call sites', () => {
    const hits = analyzer().callers('/src/math.ts', at(MATH, 'export function add', 'add'))
    expect(hits.find((h) => h.name === 'double')?.sites).toBe(1)
  })
})

describe('standard library', () => {
  // Measured: with no lib definitions loaded, three of these four patterns fail
  // to resolve, because the receiver's type is lost passing through a built-in.
  // The bundle is generated by scripts/build-libs.mjs and keyed the same way.
  const libs = () => new Map<string, string>(
    Object.entries(JSON.parse(readFileSync('public/ts-libs.json', 'utf8')) as Record<string, string>),
  )

  const MODEL = `export class User {
  constructor(public name: string) {}
  greet(): string { return 'hi ' + this.name }
}
export function make(n: string): User { return new User(n) }
`
  const USES = `import { make, User } from './model'

export function throughArray(names: string[]): string[] {
  return names.map(make).map((u) => u.greet())
}

export async function throughAwait(p: Promise<User>): Promise<string> {
  return (await p).greet()
}

export function throughSpread(users: Set<User>): string[] {
  return [...users].map((u) => u.greet())
}
`
  const withLibs = () => new Analyzer(
    [{ path: '/src/model.ts', text: MODEL }, { path: '/src/uses.ts', text: USES }],
    libs(),
  )

  it('bundles the lib entry point the host asks for', () => {
    expect(libs().has('lib.es2022.d.ts')).toBe(true)
  })

  for (const fn of ['throughArray', 'throughAwait', 'throughSpread']) {
    it(`resolves a method call whose receiver flows through a built-in (${fn})`, () => {
      const card = withLibs().card('/src/uses.ts', USES.indexOf(fn))!
      const greet = card.links.find((l) => l.name === 'greet')
      expect(greet?.target?.file).toBe('/src/model.ts')
    })
  }
})

describe('quickInfo', () => {
  it('describes a function signature', () => {
    const info = analyzer().quickInfo('/src/math.ts', at(MATH, 'export function add', 'add'))
    expect(info).toContain('add')
    expect(info).toContain('number')
  })
})
