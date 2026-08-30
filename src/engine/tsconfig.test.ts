import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Analyzer } from './analyzer'
import { readPathMapping } from './tsconfig'
import type { SourceFile } from './types'

const libs = () => new Map<string, string>(
  Object.entries(JSON.parse(readFileSync('public/ts-libs.json', 'utf8')) as Record<string, string>),
)

describe('readPathMapping', () => {
  it('makes a relative target absolute against the config it came from', () => {
    const m = readPathMapping(
      [{ path: '/tsconfig.json', text: '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}' }],
      new Map(),
    )
    expect(m.paths).toEqual({ '@/*': ['/src/*'] })
  })

  it('keeps a nested package’s alias pointing inside that package', () => {
    const m = readPathMapping(
      [{ path: '/packages/docs/tsconfig.json', text: '{"compilerOptions":{"paths":{"@/*":["./*"]}}}' }],
      new Map(),
    )
    expect(m.paths).toEqual({ '@/*': ['/packages/docs/*'] })
  })

  it('merges the same alias from several packages', () => {
    const m = readPathMapping([
      { path: '/apps/web/tsconfig.json', text: '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}' },
      { path: '/apps/api/tsconfig.json', text: '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}' },
    ], new Map())
    // Both targets are offered; TypeScript tries them in order, so which comes
    // first is not something this needs to pin down.
    expect([...m.paths!['@/*']].sort()).toEqual(['/apps/api/src/*', '/apps/web/src/*'])
  })

  it('honours baseUrl when resolving targets', () => {
    const m = readPathMapping(
      [{ path: '/tsconfig.json', text: '{"compilerOptions":{"baseUrl":"./src","paths":{"~/*":["lib/*"]}}}' }],
      new Map(),
    )
    expect(m.paths!['~/*']).toContain('/src/lib/*')
  })

  it('turns a bare baseUrl into a catch-all', () => {
    const m = readPathMapping(
      [{ path: '/tsconfig.json', text: '{"compilerOptions":{"baseUrl":"./src"}}' }],
      new Map(),
    )
    expect(m.paths!['*']).toEqual(['/src/*'])
  })

  it('tolerates comments and trailing commas', () => {
    const m = readPathMapping([{
      path: '/tsconfig.json',
      text: '{\n  // aliases\n  "compilerOptions": { "paths": { "@/*": ["./src/*"], } },\n}',
    }], new Map())
    expect(m.paths).toEqual({ '@/*': ['/src/*'] })
    expect(m.problems).toEqual([])
  })

  it('reports a malformed config instead of throwing', () => {
    const m = readPathMapping([{ path: '/tsconfig.json', text: '{ not json at all' }], new Map())
    expect(m.problems).toHaveLength(1)
    expect(m.problems[0]).toContain('/tsconfig.json')
  })

  it('follows a relative extends chain', () => {
    const m = readPathMapping([
      { path: '/tsconfig.json', text: '{"extends":"./base.json"}' },
      { path: '/base.json', text: '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}' },
    ], new Map())
    expect(m.paths!['@/*']).toContain('/src/*')
  })

  it('has nothing to say about a project with no aliases', () => {
    const m = readPathMapping([{ path: '/tsconfig.json', text: '{"compilerOptions":{}}' }], new Map())
    expect(m.paths).toBeUndefined()
    expect(m.baseUrl).toBeUndefined()
  })
})

describe('workspace packages', () => {
  const files = new Map([
    ['/packages/ui/src/index.ts', ''],
    ['/packages/ui/src/button.ts', ''],
    ['/apps/web/src/app.ts', ''],
  ])
  const pkg = (path: string, name: string) => ({ path, text: JSON.stringify({ name }) })

  it('points a package name at its source entry', () => {
    const m = readPathMapping([], files, [pkg('/packages/ui/package.json', '@acme/ui')])
    expect(m.paths!['@acme/ui']).toEqual(['/packages/ui/src/index.ts'])
  })

  it('maps subpath imports into the package source', () => {
    const m = readPathMapping([], files, [pkg('/packages/ui/package.json', '@acme/ui')])
    expect(m.paths!['@acme/ui/*']).toEqual(['/packages/ui/src/*', '/packages/ui/*'])
  })

  it('ignores a package whose directory holds no loaded source', () => {
    const m = readPathMapping([], files, [pkg('/packages/empty/package.json', '@acme/empty')])
    expect(m.paths?.['@acme/empty']).toBeUndefined()
  })

  it('ignores the root package.json, which names the whole tree', () => {
    const m = readPathMapping([], files, [pkg('/package.json', 'monorepo')])
    expect(m.paths?.['monorepo']).toBeUndefined()
  })

  it('reports malformed package.json without throwing', () => {
    const m = readPathMapping([], files, [{ path: '/packages/ui/package.json', text: '{oops' }])
    expect(m.problems[0]).toContain('/packages/ui/package.json')
  })

  it('resolves a call across two workspace packages', () => {
    const BUTTON = `export function render(label: string): string {
  return '[' + label + ']'
}
`
    const APP = `import { render } from '@acme/ui'

export function page(): string {
  return render('ok')
}
`
    const a = new Analyzer(
      [{ path: '/packages/ui/src/index.ts', text: BUTTON }, { path: '/apps/web/src/app.ts', text: APP }],
      libs(),
      [],
      [pkg('/packages/ui/package.json', '@acme/ui')],
    )
    const card = a.card('/apps/web/src/app.ts', APP.indexOf('page'))!
    const link = card.links.find((l) => l.name === 'render' && l.role === 'call')
    expect(link?.target).toEqual({ file: '/packages/ui/src/index.ts', pos: BUTTON.indexOf('render') })
  })
})

describe('ESM-style relative imports', () => {
  // Modern TypeScript projects write `./thing.js` and ship `./thing.ts`.
  // If that substitution fails, every symbol in such a project goes dead.
  const HELPER = `export function helper(n: number): number {
  return n * 2
}
`
  const USES = `import { helper } from './helper.js'

export function run(n: number): number {
  return helper(n)
}
`
  it('resolves an import written with a .js extension to the .ts file', () => {
    const a = new Analyzer([
      { path: '/src/helper.ts', text: HELPER },
      { path: '/src/uses.ts', text: USES },
    ], libs())
    const card = a.card('/src/uses.ts', USES.indexOf('run'))!
    const link = card.links.find((l) => l.name === 'helper' && l.role === 'call')
    expect(link?.target).toEqual({ file: '/src/helper.ts', pos: HELPER.indexOf('helper') })
  })

  it('resolves an extensionless directory import to its index file', () => {
    const a = new Analyzer([
      { path: '/src/lib/index.ts', text: HELPER },
      { path: '/src/uses.ts', text: USES.replace('./helper.js', './lib') },
    ], libs())
    const card = a.card('/src/uses.ts', USES.indexOf('run'))!
    expect(card.links.find((l) => l.name === 'helper')?.target?.file).toBe('/src/lib/index.ts')
  })
})

describe('aliased imports end to end', () => {
  const GREET = `export function greet(name: string): string {
  return 'hi ' + name
}
`
  const PAGE = `import { greet } from '@/lib/greet'

export function render(who: string): string {
  return greet(who)
}
`
  const sources: SourceFile[] = [
    { path: '/src/lib/greet.ts', text: GREET },
    { path: '/src/app/page.ts', text: PAGE },
  ]
  const config = { path: '/tsconfig.json', text: '{"compilerOptions":{"paths":{"@/*":["./src/*"]}}}' }

  it('resolves a call through an aliased import', () => {
    const a = new Analyzer(sources, libs(), [config])
    const card = a.card('/src/app/page.ts', PAGE.indexOf('render'))!
    const link = card.links.find((l) => l.name === 'greet' && l.role === 'call')
    expect(link?.target).toEqual({ file: '/src/lib/greet.ts', pos: GREET.indexOf('greet') })
  })

  it('finds a caller across an aliased import', () => {
    const a = new Analyzer(sources, libs(), [config])
    const who = a.callers('/src/lib/greet.ts', GREET.indexOf('greet'))
    expect(who.map((h) => h.name)).toContain('render')
  })

  it('leaves the same call unresolved without the config, which is the bug this fixes', () => {
    const a = new Analyzer(sources, libs())
    const card = a.card('/src/app/page.ts', PAGE.indexOf('render'))!
    const link = card.links.find((l) => l.name === 'greet' && l.role === 'call')
    expect(link?.target).toBeNull()
  })
})
