import type { ConfigFile } from '../engine/tsconfig'
import type { SourceFile } from '../engine/types'

const SOURCE_EXT = /\.(mts|cts|tsx?|jsx?)$/
const CONFIG_NAME = /^(ts|js)config(\.[\w-]+)?\.json$/
const PACKAGE_NAME = 'package.json'
const SKIP_DIR = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo',
  '.svelte-kit', 'vendor', '.venv', '__pycache__',
])
const MAX_FILES = 4000
const MAX_BYTES = 24 * 1024 * 1024

export interface LoadedProject {
  name: string
  files: SourceFile[]
  /** tsconfig files, read so that aliased imports resolve. */
  configs: ConfigFile[]
  /** package.json files, read so that workspace packages resolve by name. */
  packages: ConfigFile[]
  /** Source files left out because the project exceeded the size limits. */
  skipped: number
}

/** Minimal shape of the File System Access API, which TypeScript's DOM lib may predate. */
interface DirHandle {
  name: string
  kind: 'directory'
  values(): AsyncIterableIterator<DirHandle | FileHandle>
}
interface FileHandle {
  name: string
  kind: 'file'
  getFile(): Promise<File>
}

export const canPickDirectory = () => 'showDirectoryPicker' in globalThis

/** Opens a folder through the File System Access API. Chromium only. */
export async function pickDirectory(): Promise<LoadedProject | null> {
  const picker = (globalThis as unknown as {
    showDirectoryPicker(o?: { mode?: string }): Promise<DirHandle>
  }).showDirectoryPicker
  let root: DirHandle
  try {
    root = await picker({ mode: 'read' })
  } catch {
    return null // the user dismissed the picker
  }

  const files: SourceFile[] = []
  const configs: ConfigFile[] = []
  const packages: ConfigFile[] = []
  let bytes = 0
  let skipped = 0

  const walk = async (dir: DirHandle, prefix: string): Promise<void> => {
    for await (const entry of dir.values()) {
      if (entry.kind === 'directory') {
        if (entry.name.startsWith('.') || SKIP_DIR.has(entry.name)) continue
        await walk(entry, `${prefix}/${entry.name}`)
      } else if (entry.name === PACKAGE_NAME) {
        packages.push({ path: `${prefix}/${entry.name}`, text: await (await entry.getFile()).text() })
      } else if (CONFIG_NAME.test(entry.name)) {
        configs.push({ path: `${prefix}/${entry.name}`, text: await (await entry.getFile()).text() })
      } else if (SOURCE_EXT.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        if (files.length >= MAX_FILES || bytes >= MAX_BYTES) {
          skipped += 1
          continue
        }
        const file = await entry.getFile()
        const text = await file.text()
        bytes += text.length
        files.push({ path: `${prefix}/${entry.name}`, text })
      }
    }
  }

  await walk(root, '')
  return { name: root.name, files, configs, packages, skipped }
}

/** Fallback for browsers without a directory picker: a directory <input>. */
export async function readFileList(list: FileList): Promise<LoadedProject> {
  const files: SourceFile[] = []
  const configs: ConfigFile[] = []
  const packages: ConfigFile[] = []
  let bytes = 0
  let skipped = 0
  let name = 'project'

  for (const file of Array.from(list)) {
    const relative: string = (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name
    const parts = relative.split('/')
    if (parts.length > 1) name = parts[0]
    if (parts.some((p) => SKIP_DIR.has(p) || (p.startsWith('.') && p !== parts.at(-1)))) continue
    // Drop the top-level folder so paths match what the picker produces.
    const path = '/' + parts.slice(1).join('/')

    if (file.name === PACKAGE_NAME) {
      packages.push({ path, text: await file.text() })
      continue
    }
    if (CONFIG_NAME.test(file.name)) {
      configs.push({ path, text: await file.text() })
      continue
    }
    if (!SOURCE_EXT.test(file.name) || file.name.endsWith('.d.ts')) continue
    if (files.length >= MAX_FILES || bytes >= MAX_BYTES) {
      skipped += 1
      continue
    }
    const text = await file.text()
    bytes += text.length
    files.push({ path, text })
  }

  return { name, files, configs, packages, skipped }
}
