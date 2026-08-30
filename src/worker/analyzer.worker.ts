import { Analyzer } from '../engine/analyzer'
import type { Ops, Request, Response } from './protocol'

let analyzer: Analyzer | null = null

function required(): Analyzer {
  if (!analyzer) throw new Error('no project loaded')
  return analyzer
}

async function fetchLibs(url: string): Promise<Map<string, string>> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not load type definitions (${res.status})`)
  return new Map(Object.entries((await res.json()) as Record<string, string>))
}

const ops: { [K in keyof Ops]: (p: Parameters<Ops[K]>[0]) => Promise<ReturnType<Ops[K]>> } = {
  async load({ files, libsUrl }) {
    analyzer = new Analyzer(files, await fetchLibs(libsUrl))
    // Force the program to build here so the first card request is already warm.
    analyzer.program.getTypeChecker()
    return { files: analyzer.paths() }
  },
  async search({ query }) {
    return required().search(query)
  },
  async outline({ file }) {
    return required().outline(file)
  },
  async card({ file, pos }) {
    return required().card(file, pos)
  },
  async callers({ file, pos }) {
    return required().callers(file, pos)
  },
  async quickInfo({ file, pos }) {
    return required().quickInfo(file, pos)
  },
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, op, params } = event.data
  const reply = (r: Response) => self.postMessage(r)
  try {
    const handler = ops[op] as (p: unknown) => Promise<unknown>
    if (!handler) throw new Error(`unknown operation: ${op}`)
    reply({ id, ok: true, result: await handler(params) })
  } catch (err) {
    reply({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
