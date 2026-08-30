import type { SourceFile } from '../engine/types'

/**
 * The demo project is Sightline's own source, inlined at build time.
 *
 * A tool for reading code should be demonstrable on code worth reading, and
 * this way the demo can never drift out of date.
 */
const modules = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  eager: true,
  import: 'default',
}) as Record<string, string>

export const DEMO_NAME = 'sightline'

/**
 * Glob keys are relative to this file, and Vite writes them the shortest way:
 * `./Canvas.tsx` for a sibling, `../engine/analyzer.ts` for anything else. They
 * have to be joined against this directory and normalised, or the demo's own
 * directory layout comes out wrong and its relative imports stop resolving.
 */
function toProjectPath(key: string): string {
  const segments: string[] = []
  for (const part of `src/app/${key}`.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return '/' + segments.join('/')
}

export function demoProject(): SourceFile[] {
  return Object.entries(modules)
    .map(([key, text]) => ({ path: toProjectPath(key), text }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** Where to drop the reader when the demo opens. */
export const DEMO_ENTRY = { file: '/src/engine/analyzer.ts', symbol: 'card' }
