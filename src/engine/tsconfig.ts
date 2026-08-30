import ts from 'typescript'
import { normalizePath } from './host'

export interface ConfigFile {
  path: string
  text: string
}

/** The parts of a tsconfig that decide where a non-relative import points. */
export interface PathMapping {
  baseUrl?: string
  paths?: ts.MapLike<string[]>
  /** Config files that were found but could not be read, for reporting. */
  problems: string[]
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

/** Resolves a possibly-relative tsconfig target against the directory it was written in. */
function resolveFrom(base: string, target: string): string {
  if (target.startsWith('/')) return target
  const segments: string[] = []
  for (const part of `${base}/${target}`.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return '/' + segments.join('/')
}

/**
 * Lifts `baseUrl` and `paths` out of a project's tsconfig files.
 *
 * Without this, an import written as `@/lib/thing` resolves to nothing and every
 * symbol reached through it goes dead — which is most of them, in the many
 * projects that alias their own source directory.
 *
 * Mappings from every config found are merged rather than picking one, because a
 * single language service covers the whole folder the reader opened, including
 * monorepos where each package aliases its own paths. Each target is made
 * absolute against the config that declared it first, so a nested package's
 * `"@/*": ["./*"]` keeps pointing inside that package.
 */
export function readPathMapping(
  configs: ConfigFile[],
  files: Map<string, string>,
  packages: ConfigFile[] = [],
): PathMapping {
  const problems: string[] = []
  const merged: ts.MapLike<string[]> = {}

  const texts = new Map(configs.map((c) => [normalizePath(c.path), c.text]))
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    fileExists: (p) => texts.has(p) || files.has(p),
    readFile: (p) => texts.get(p) ?? files.get(p),
    readDirectory: () => [],
  }

  // Shallowest first, so a root config's aliases are tried before a nested one's.
  const ordered = [...configs].sort(
    (a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path),
  )

  for (const config of ordered) {
    const path = normalizePath(config.path)
    const parsed = ts.parseConfigFileTextToJson(path, config.text)
    if (parsed.error || !parsed.config) {
      problems.push(`${path}: ${describe(parsed.error)}`)
      continue
    }

    let options: ts.CompilerOptions
    try {
      options = ts.parseJsonConfigFileContent(parsed.config, host, dirOf(path), undefined, path).options
    } catch (err) {
      // A config that extends a package which was not loaded cannot be followed.
      problems.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }

    const base = options.baseUrl ? normalizePath(options.baseUrl) : dirOf(path)
    for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
      const absolute = targets.map((t) => resolveFrom(base, t))
      const existing = merged[pattern] ?? []
      merged[pattern] = [...existing, ...absolute.filter((t) => !existing.includes(t))]
    }

    // A bare `baseUrl` also makes non-relative imports resolve against it, so
    // fold it in as a catch-all rather than dropping it.
    if (options.baseUrl) {
      const wildcard = merged['*'] ?? []
      const target = resolveFrom(normalizePath(options.baseUrl), '*')
      if (!wildcard.includes(target)) merged['*'] = [...wildcard, target]
    }
  }

  addWorkspacePackages(packages, files, merged, problems)

  const paths = Object.keys(merged).length ? merged : undefined
  // Every target is already absolute, so the base only has to be a valid root.
  return { baseUrl: paths ? '/' : undefined, paths, problems }
}

const INDEX_FILES = ['src/index.ts', 'src/index.tsx', 'index.ts', 'index.tsx', 'src/main.ts']

/**
 * Maps each workspace package's own name onto its source directory.
 *
 * In a monorepo, packages import one another by name (`@acme/ui`, `zod/v4`) and
 * that name normally resolves through a symlink in node_modules into a built
 * `dist` — neither of which exists here. Pointing the name at the source instead
 * is what lets a reader follow a call from one package into another.
 */
function addWorkspacePackages(
  packages: ConfigFile[],
  files: Map<string, string>,
  merged: ts.MapLike<string[]>,
  problems: string[],
): void {
  for (const pkg of packages) {
    const path = normalizePath(pkg.path)
    let name: unknown
    try {
      name = (JSON.parse(pkg.text) as { name?: unknown }).name
    } catch {
      problems.push(`${path}: not valid JSON`)
      continue
    }
    if (typeof name !== 'string' || !name) continue

    const dir = dirOf(path)
    const prefix = dir === '/' ? '/' : dir + '/'
    // The root package.json of a single-package project describes the whole
    // tree; mapping its name to itself would shadow nothing useful.
    if (dir === '/') continue
    if (![...files.keys()].some((f) => f.startsWith(prefix))) continue

    const entries = INDEX_FILES.map((f) => `${dir}/${f}`).filter((f) => files.has(f))
    if (entries.length) {
      const existing = merged[name] ?? []
      merged[name] = [...existing, ...entries.filter((e) => !existing.includes(e))]
    }

    const pattern = `${name}/*`
    const targets = [`${dir}/src/*`, `${dir}/*`]
    const existing = merged[pattern] ?? []
    merged[pattern] = [...existing, ...targets.filter((t) => !existing.includes(t))]
  }
}

function describe(error: ts.Diagnostic | undefined): string {
  return error ? ts.flattenDiagnosticMessageText(error.messageText, ' ') : 'could not be parsed'
}
