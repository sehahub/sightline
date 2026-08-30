import { memo, useMemo } from 'react'
import type { CallerHit, CardLink } from '../engine/types'
import { CARD_W, cardHeight, type PlacedCard } from './layout'
import { layoutLines } from './segments'

const KIND_LABEL: Record<string, string> = {
  function: 'fn', method: 'fn', constructor: 'new', getter: 'get', setter: 'set',
  class: 'class', interface: 'type', type: 'type', enum: 'enum', variable: 'const',
  module: 'mod',
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** A call made at module scope is reported against the source file itself. */
const callerLabel = (hit: CallerHit) =>
  hit.kind === 'script' || hit.name.includes('/') ? 'top level' : hit.name

interface Props {
  placed: PlacedCard
  focused: boolean
  /** Ids of every card on the canvas, so links to them can say so. */
  openIds: Set<string>
  callers: CallerHit[] | 'loading' | null
  onOpenLink: (link: CardLink) => void
  onOpenCaller: (hit: CallerHit) => void
  onToggleCallers: () => void
  onClose: () => void
  onGrab: (event: React.PointerEvent<HTMLElement>) => void
}

function CardViewInner({
  placed, focused, openIds, callers, onOpenLink, onOpenCaller, onToggleCallers, onClose, onGrab,
}: Props) {
  const { card } = placed
  const lines = useMemo(() => layoutLines(card), [card])

  return (
    <article
      className={`card${focused ? ' focused' : ''}`}
      style={{
        transform: `translate(${placed.x}px, ${placed.y}px)`,
        width: CARD_W,
        height: cardHeight(card),
      }}
    >
      <header className="card-head" onPointerDown={onGrab}>
        <span className={`kind kind-${card.kind}`}>{KIND_LABEL[card.kind] ?? card.kind}</span>
        <span className="card-title">
          {card.containerName && <span className="container">{card.containerName}.</span>}
          {card.name}
        </span>
        <span className="loc">{basename(card.file)}:{card.startLine}</span>
        <button
          type="button"
          className={`act${callers ? ' on' : ''}`}
          onClick={onToggleCallers}
          title="Who calls this"
        >
          callers
        </button>
        <button type="button" className="act close" onClick={onClose} title="Close card">
          ×
        </button>
      </header>

      {callers && (
        <div className="callers">
          {callers === 'loading' && <span className="muted">searching…</span>}
          {callers !== 'loading' && callers.length === 0 && (
            <span className="muted">no callers in this project</span>
          )}
          {callers !== 'loading' && callers.map((hit) => (
            <button
              type="button"
              key={`${hit.file}#${hit.pos}`}
              className="caller"
              onClick={() => onOpenCaller(hit)}
            >
              <span className={callerLabel(hit) === 'top level' ? 'muted' : ''}>
                {callerLabel(hit)}
              </span>
              <span className="loc">{basename(hit.file)}</span>
              {hit.sites > 1 && <span className="sites">{hit.sites}×</span>}
            </button>
          ))}
        </div>
      )}

      <div className="code">
        {lines.map((line, i) => (
          <div className="row" key={i}>
            <span className="gutter">{line.no}</span>
            <code className="line">
              {line.segments.map((seg, j) => {
                const cls = seg.cls ? `tok ${seg.cls}` : 'tok'
                if (seg.link?.target) {
                  const { file, pos } = seg.link.target
                  const already = openIds.has(`${file}#${pos}`)
                  return (
                    <button
                      type="button"
                      key={j}
                      className={`${cls} nav${already ? ' already' : ''}`}
                      title={already ? 'Already on the canvas' : undefined}
                      onClick={() => onOpenLink(seg.link!)}
                    >
                      {seg.text}
                    </button>
                  )
                }
                if (seg.link?.external) {
                  return (
                    <span key={j} className={`${cls} ext`} title="Defined outside this project">
                      {seg.text}
                    </span>
                  )
                }
                return <span key={j} className={cls}>{seg.text}</span>
              })}
            </code>
          </div>
        ))}
      </div>
    </article>
  )
}

export const CardView = memo(CardViewInner)
