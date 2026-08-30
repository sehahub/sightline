/**
 * Bundles the TypeScript standard library definitions the analyzer needs.
 *
 * Without these, resolution silently degrades: a value that passes through
 * `.map()`, `await` or a spread loses its type, and method calls on it stop
 * resolving to user code. DOM definitions are deliberately excluded — they
 * cost 3 MB and improve nothing, because DOM declarations live outside the
 * loaded project and are reported as external either way.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const libDir = join(root, 'node_modules', 'typescript', 'lib')
const ENTRY = 'lib.es2022.d.ts'

const REFERENCE = /\/\/\/\s*<reference\s+lib\s*=\s*["']([^"']+)["']\s*\/>/g

const bundle = {}
const queue = [ENTRY]

while (queue.length) {
  const name = queue.shift()
  if (name in bundle) continue
  let text
  try {
    text = readFileSync(join(libDir, name), 'utf8')
  } catch {
    console.warn(`  skipped missing ${name}`)
    continue
  }
  bundle[name] = text
  for (const [, ref] of text.matchAll(REFERENCE)) queue.push(`lib.${ref}.d.ts`)
}

const outDir = join(root, 'public')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'ts-libs.json')
writeFileSync(outFile, JSON.stringify(bundle))

const bytes = Object.values(bundle).reduce((n, s) => n + s.length, 0)
console.log(
  `ts-libs.json: ${Object.keys(bundle).length} files, ${(bytes / 1024).toFixed(0)} KB from ${ENTRY}`,
)
