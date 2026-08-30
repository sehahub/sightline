import type { Op, Params, Request, Response, Result } from './protocol'

/** Promise-based wrapper around the analyzer worker. */
export class AnalyzerClient {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>()

  constructor() {
    this.worker = new Worker(new URL('./analyzer.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event: MessageEvent<Response>) => {
      const msg = event.data
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      if (msg.ok) entry.resolve(msg.result as never)
      else entry.reject(new Error(msg.error))
    }
    this.worker.onerror = (event) => {
      const error = new Error(event.message || 'analyzer worker crashed')
      for (const { reject } of this.pending.values()) reject(error)
      this.pending.clear()
    }
  }

  call<K extends Op>(op: K, params: Params<K>): Promise<Result<K>> {
    const id = this.nextId++
    const request: Request<K> = { id, op, params }
    return new Promise<Result<K>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject })
      this.worker.postMessage(request)
    })
  }

  dispose() {
    this.worker.terminate()
    this.pending.clear()
  }
}
