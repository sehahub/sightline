import type { SymbolHit } from '../engine/types'

const KIND_LABEL: Record<string, string> = {
  function: 'fn', method: 'fn', constructor: 'new', getter: 'get', setter: 'set',
  class: 'class', interface: 'type', type: 'type', enum: 'enum', variable: 'const',
  module: 'mod',
}

interface Props {
  projectName: string
  files: string[]
  query: string
  onQuery: (q: string) => void
  results: SymbolHit[]
  openFile: string | null
  outline: SymbolHit[]
  onSelectFile: (file: string) => void
  onOpenSymbol: (hit: SymbolHit) => void
  searchRef: React.RefObject<HTMLInputElement | null>
}

export function Sidebar({
  projectName, files, query, onQuery, results, openFile, outline, onSelectFile, onOpenSymbol,
  searchRef,
}: Props) {
  const searching = query.trim().length > 0

  return (
    <aside className="sidebar">
      <div className="project">
        <span className="project-name">{projectName}</span>
        <span className="muted">{files.length} files</span>
      </div>

      <input
        ref={searchRef}
        className="search"
        value={query}
        placeholder="Search symbols…"
        spellCheck={false}
        onChange={(e) => onQuery(e.target.value)}
      />

      <div className="listing">
        {searching && results.length === 0 && <p className="muted pad">No symbol matches.</p>}

        {searching && results.map((hit) => (
          <button
            type="button"
            key={`${hit.file}#${hit.pos}`}
            className="hit"
            onClick={() => onOpenSymbol(hit)}
          >
            <span className={`kind kind-${hit.kind}`}>{KIND_LABEL[hit.kind] ?? hit.kind}</span>
            <span className="hit-name">
              {hit.containerName && <span className="container">{hit.containerName}.</span>}
              {hit.name}
            </span>
            <span className="hit-file">{hit.file.replace(/^\//, '')}</span>
          </button>
        ))}

        {!searching && files.map((file) => (
          <div key={file}>
            <button
              type="button"
              className={`file${openFile === file ? ' open' : ''}`}
              onClick={() => onSelectFile(file)}
            >
              <span className="chev">{openFile === file ? '▾' : '▸'}</span>
              {file.replace(/^\//, '')}
            </button>
            {openFile === file && (
              <div className="outline">
                {outline.length === 0 && <p className="muted pad">No declarations.</p>}
                {outline.map((hit) => (
                  <button
                    type="button"
                    key={hit.pos}
                    className="hit"
                    onClick={() => onOpenSymbol(hit)}
                  >
                    <span className={`kind kind-${hit.kind}`}>
                      {KIND_LABEL[hit.kind] ?? hit.kind}
                    </span>
                    <span className="hit-name">
                      {hit.containerName && <span className="container">{hit.containerName}.</span>}
                      {hit.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}
