import ts from 'typescript'

/**
 * A LanguageServiceHost backed entirely by an in-memory file map.
 *
 * Every filesystem method must be answered from `files` / `libs`. Delegating any
 * of them to `ts.sys` breaks module resolution: TypeScript calls `directoryExists`
 * as a fast path before probing for files inside a directory, so a host that
 * answers "no" for a virtual directory silently resolves imports to nothing.
 */
export interface HostFiles {
  /** Absolute posix paths ("/src/main.ts") to file text. */
  files: Map<string, string>
  /** Lib file name ("lib.es2022.d.ts") to text. An empty map means noLib. */
  libs: Map<string, string>
  /** `baseUrl`/`paths` from the project's tsconfig, so aliased imports resolve. */
  aliases?: { baseUrl?: string; paths?: ts.MapLike<string[]> }
}

export const LIB_DIR = '/__lib__'

/**
 * Entry point into the bundled standard library. Deliberately not the `.full`
 * variant TypeScript would pick by default: that one pulls in DOM, which costs
 * 3 MB and resolves nothing extra, since DOM declarations sit outside the
 * loaded project and are reported as external regardless.
 *
 * Must match the entry in scripts/build-libs.mjs.
 */
export const DEFAULT_LIB = 'lib.es2022.d.ts'

export function normalizePath(p: string): string {
  const posix = p.split('\\').join('/')
  return posix.startsWith('/') ? posix : '/' + posix.replace(/^\.\//, '')
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

export interface VfsHost extends ts.LanguageServiceHost {
  /** Replace a file's contents and bump its version. */
  write(path: string, text: string): void
  has(path: string): boolean
  read(path: string): string | undefined
  paths(): string[]
}

export function createHost({ files, libs, aliases }: HostFiles): VfsHost {
  const versions = new Map<string, number>()
  for (const p of files.keys()) versions.set(p, 1)

  const libPath = (name: string) => `${LIB_DIR}/${name}`

  const lookup = (fileName: string): string | undefined => {
    const f = files.get(fileName)
    if (f !== undefined) return f
    if (fileName.startsWith(LIB_DIR + '/')) return libs.get(fileName.slice(LIB_DIR.length + 1))
    return undefined
  }

  // Directories are implied by the file paths that live under them.
  const directories = (): Set<string> => {
    const dirs = new Set<string>(['/'])
    for (const p of files.keys()) {
      let d = dirOf(p)
      while (d && d !== '/' && !dirs.has(d)) {
        dirs.add(d)
        d = dirOf(d)
      }
    }
    if (libs.size) dirs.add(LIB_DIR)
    return dirs
  }

  const host: VfsHost = {
    getScriptFileNames: () => [...files.keys()],
    getScriptVersion: (f) => String(versions.get(f) ?? 0),
    getScriptSnapshot: (f) => {
      const text = lookup(f)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => '/',
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
      checkJs: false,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      noEmit: true,
      noLib: libs.size === 0,
      // Reading unfamiliar code should never be blocked by someone else's
      // strictness settings, and looser checking keeps resolution cheaper.
      strict: false,
      // Everything above is ours to decide; these two belong to the project
      // being read, and without them aliased imports resolve to nothing.
      baseUrl: aliases?.baseUrl,
      paths: aliases?.paths,
    }),
    getDefaultLibFileName: () => libPath(DEFAULT_LIB),
    fileExists: (f) => lookup(f) !== undefined,
    readFile: (f) => lookup(f),
    directoryExists: (d) => {
      const n = d.endsWith('/') && d !== '/' ? d.slice(0, -1) : d
      return directories().has(n)
    },
    getDirectories: (d) => {
      const prefix = d === '/' ? '/' : d + '/'
      const out = new Set<string>()
      for (const dir of directories()) {
        if (dir !== d && dir.startsWith(prefix)) {
          const rest = dir.slice(prefix.length)
          if (rest && !rest.includes('/')) out.add(rest)
        }
      }
      return [...out]
    },
    readDirectory: (d, extensions) => {
      const prefix = d === '/' ? '/' : d + '/'
      return [...files.keys()].filter(
        (p) => p.startsWith(prefix) && (!extensions || extensions.some((e) => p.endsWith(e))),
      )
    },
    realpath: (p) => p,

    write(path, text) {
      const p = normalizePath(path)
      files.set(p, text)
      versions.set(p, (versions.get(p) ?? 0) + 1)
    },
    has: (p) => files.has(normalizePath(p)),
    read: (p) => files.get(normalizePath(p)),
    paths: () => [...files.keys()],
  }

  return host
}
