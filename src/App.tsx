import { useCallback, useEffect, useRef, useState } from 'react'
import type { CallerHit, Card, CardLink, SourceFile, SymbolHit } from './engine/types'
import { AnalyzerClient } from './worker/client'
import { Canvas } from './app/Canvas'
import { Sidebar } from './app/Sidebar'
import { HEADER_H, bounds, offsetY, panToCard, place, type PlacedCard, type View } from './app/layout'
import { DEMO_ENTRY, DEMO_NAME, demoProject } from './app/demo'
import { canPickDirectory, pickDirectory, readFileList } from './app/openFolder'

const LIBS_URL = `${import.meta.env.BASE_URL}ts-libs.json`

type Status =
  | { kind: 'empty' }
  | { kind: 'loading'; label: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

export default function App() {
  const [client, setClient] = useState<AnalyzerClient | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'empty' })
  const [projectName, setProjectName] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)

  const [cards, setCards] = useState<PlacedCard[]>([])
  const [view, setView] = useState<View>({ x: 80, y: 80, scale: 1 })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [panTick, setPanTick] = useState(0)
  const [callers, setCallers] = useState<Record<string, CallerHit[] | 'loading'>>({})

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SymbolHit[]>([])
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [outline, setOutline] = useState<SymbolHit[]>([])

  const viewportRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const c = new AnalyzerClient()
    setClient(c)
    return () => c.dispose()
  }, [])

  const loadProject = useCallback(async (name: string, sources: SourceFile[], skipped = 0) => {
    if (!client) return null
    if (sources.length === 0) {
      setStatus({ kind: 'error', message: 'No TypeScript or JavaScript files found in that folder.' })
      return null
    }
    setStatus({ kind: 'loading', label: `Indexing ${sources.length} files` })
    setCards([])
    setCallers({})
    setQuery('')
    setOpenFile(null)
    try {
      const loaded = await client.call('load', { files: sources, libsUrl: LIBS_URL })
      setFiles(loaded.files)
      setProjectName(name)
      setStatus({ kind: 'ready' })
      setNotice(skipped > 0 ? `${skipped} files skipped — project exceeds the size limit.` : null)
      return loaded.files
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      return null
    }
  }, [client])

  const addCard = useCallback((
    card: Card,
    parentId: string | null,
    anchorOffset: number,
    direction: 1 | -1,
  ) => {
    setCards((prev) => {
      if (prev.some((c) => c.card.id === card.id)) return prev
      const parent = parentId ? prev.find((c) => c.card.id === parentId) ?? null : null
      const spot = place(prev, card, parent, anchorOffset, direction)
      return [...prev, { card, ...spot, parentId: parent?.card.id ?? null, anchorOffset }]
    })
    setFocusId(card.id)
    setPanTick((n) => n + 1)
  }, [])

  const openAt = useCallback(async (
    file: string, pos: number, parentId: string | null, anchorOffset: number, direction: 1 | -1,
  ) => {
    if (!client) return
    const card = await client.call('card', { file, pos })
    if (card) addCard(card, parentId, anchorOffset, direction)
  }, [addCard, client])

  const openSymbol = useCallback((hit: SymbolHit) => {
    void openAt(hit.file, hit.pos, null, 0, 1)
  }, [openAt])

  const openLink = useCallback((parent: PlacedCard, link: CardLink) => {
    if (!link.target) return
    void openAt(link.target.file, link.target.pos, parent.card.id, offsetY(parent.card, link.start), 1)
  }, [openAt])

  const openCaller = useCallback((parent: PlacedCard, hit: CallerHit) => {
    void openAt(hit.file, hit.pos, parent.card.id, HEADER_H / 2, -1)
  }, [openAt])

  const toggleCallers = useCallback(async (placed: PlacedCard) => {
    if (!client) return
    const id = placed.card.id
    if (callers[id]) {
      setCallers((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      return
    }
    setCallers((prev) => ({ ...prev, [id]: 'loading' }))
    const hits = await client.call('callers', { file: placed.card.file, pos: placed.card.pos })
    setCallers((prev) => (id in prev ? { ...prev, [id]: hits } : prev))
  }, [callers, client])

  const closeCard = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.card.id !== id && c.parentId !== id))
    setCallers((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const moveCard = useCallback((id: string, x: number, y: number) => {
    setCards((prev) => prev.map((c) => (c.card.id === id ? { ...c, x, y } : c)))
  }, [])

  /** Frame every open card at once — the way back when a chain runs off-screen. */
  const fitToCards = useCallback(() => {
    const node = viewportRef.current
    const box = bounds(cards)
    if (!node || !box) return
    const margin = 48
    const scale = Math.max(0.25, Math.min(
      1,
      (node.clientWidth - margin * 2) / box.w,
      (node.clientHeight - margin * 2) / box.h,
    ))
    setView({
      scale,
      x: (node.clientWidth - box.w * scale) / 2 - box.x * scale,
      y: (node.clientHeight - box.h * scale) / 2 - box.y * scale,
    })
  }, [cards])

  const selectFile = useCallback(async (file: string) => {
    if (!client) return
    if (openFile === file) {
      setOpenFile(null)
      return
    }
    setOpenFile(file)
    setOutline(await client.call('outline', { file }))
  }, [client, openFile])

  const startDemo = useCallback(async () => {
    if (!client) return
    const loaded = await loadProject(DEMO_NAME, demoProject())
    if (!loaded) return
    const entries = await client.call('outline', { file: DEMO_ENTRY.file })
    const hit = entries.find((s) => s.name === DEMO_ENTRY.symbol)
    if (hit) void openAt(hit.file, hit.pos, null, 0, 1)
  }, [client, loadProject, openAt])

  const openFolder = useCallback(async () => {
    if (canPickDirectory()) {
      const picked = await pickDirectory()
      if (picked) await loadProject(picked.name, picked.files, picked.skipped)
    } else {
      fileInputRef.current?.click()
    }
  }, [loadProject])

  // Search, debounced so each keystroke does not queue a worker round trip.
  useEffect(() => {
    if (!client || status.kind !== 'ready') return
    if (!query.trim()) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      client.call('search', { query }).then(setResults).catch(() => setResults([]))
    }, 120)
    return () => clearTimeout(timer)
  }, [client, query, status.kind])

  // Bring a newly opened card into view without yanking the whole canvas around.
  useEffect(() => {
    if (!panTick || !focusId) return
    const node = viewportRef.current
    const placed = cards.find((c) => c.card.id === focusId)
    if (!node || !placed) return
    setView((v) => panToCard(v, placed, node.clientWidth, node.clientHeight))
  }, [panTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = document.activeElement?.tagName === 'INPUT'
      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === 'Escape') {
        if (typing) searchRef.current?.blur()
        else if (focusId) closeCard(focusId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeCard, focusId])

  const ready = status.kind === 'ready'

  return (
    <div className="app">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden-input"
        // @ts-expect-error non-standard attribute, the only fallback outside Chromium
        webkitdirectory=""
        multiple
        onChange={async (e) => {
          const list = e.target.files
          if (!list?.length) return
          const project = await readFileList(list)
          await loadProject(project.name, project.files, project.skipped)
        }}
      />

      {ready && (
        <Sidebar
          projectName={projectName}
          files={files}
          query={query}
          onQuery={setQuery}
          results={results}
          openFile={openFile}
          outline={outline}
          onSelectFile={selectFile}
          onOpenSymbol={openSymbol}
          searchRef={searchRef}
        />
      )}

      <main className="stage">
        {ready ? (
          <>
            <Canvas
              cards={cards}
              view={view}
              setView={setView}
              focusId={focusId}
              callers={callers}
              onOpenLink={openLink}
              onOpenCaller={openCaller}
              onToggleCallers={toggleCallers}
              onClose={closeCard}
              onMoveCard={moveCard}
              viewportRef={viewportRef}
            />
            {cards.length === 0 && (
              <p className="hint">
                Pick a symbol on the left. Then click any call inside a card to pull the next
                function onto the canvas.
              </p>
            )}
            <div className="toolbar">
              {notice && <span className="notice">{notice}</span>}
              <button
                type="button"
                className="ghost"
                onClick={fitToCards}
                disabled={cards.length === 0}
              >
                Fit
              </button>
              <button type="button" className="ghost" onClick={() => setCards([])}>
                Clear canvas
              </button>
              <button type="button" className="ghost" onClick={openFolder}>
                Open folder
              </button>
            </div>
          </>
        ) : (
          <Splash status={status} onDemo={startDemo} onFolder={openFolder} busy={!client} />
        )}
      </main>
    </div>
  )
}

function Splash({
  status, onDemo, onFolder, busy,
}: { status: Status; onDemo: () => void; onFolder: () => void; busy: boolean }) {
  return (
    <div className="splash">
      <h1>Sightline</h1>
      <p className="tagline">
        Read a codebase as a chain of functions, not a stack of tabs. Open one function, click a
        call inside it, and the next function lands beside it — wired to the call site it came from.
      </p>

      <Diagram />

      {status.kind === 'loading' ? (
        <p className="status">{status.label}…</p>
      ) : (
        <div className="actions">
          <button type="button" className="primary" onClick={onDemo} disabled={busy}>
            Explore the demo
          </button>
          <button type="button" className="ghost" onClick={onFolder} disabled={busy}>
            Open a folder…
          </button>
        </div>
      )}

      {status.kind === 'error' && <p className="error">{status.message}</p>}

      <p className="fine">
        Resolution runs on the real TypeScript compiler, in your browser. Your code is never
        uploaded — there is no server to upload it to.
      </p>
    </div>
  )
}

/** A miniature of the canvas: one card, a call inside it, and where that call leads. */
function Diagram() {
  const bars = (x: number, y: number, widths: number[], lit = -1) =>
    widths.map((w, i) => (
      <rect
        key={i}
        x={x}
        y={y + i * 11}
        width={w}
        height={4}
        rx={2}
        className={i === lit ? 'bar lit' : 'bar'}
      />
    ))

  return (
    <svg className="diagram" viewBox="0 0 420 132" role="img" aria-label="Two linked code cards">
      <path className="thread" d="M 176 74 C 208 74, 214 40, 246 40" />
      <g className="mini">
        <rect x="8" y="20" width="168" height="98" rx="7" />
        <line x1="8" y1="40" x2="176" y2="40" />
        {bars(20, 52, [96, 128, 72, 110], 1)}
      </g>
      <g className="mini">
        <rect x="246" y="14" width="166" height="76" rx="7" />
        <line x1="246" y1="34" x2="412" y2="34" />
        {bars(258, 46, [88, 116, 64])}
      </g>
    </svg>
  )
}
