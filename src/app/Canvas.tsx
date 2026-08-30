import { useCallback, useEffect, useRef } from 'react'
import type { CallerHit, CardLink } from '../engine/types'
import { CARD_W, HEADER_H, bounds, type PlacedCard, type View } from './layout'
import { CardView } from './CardView'

const MIN_SCALE = 0.25
const MAX_SCALE = 1.6

interface Props {
  cards: PlacedCard[]
  view: View
  setView: (update: (v: View) => View) => void
  focusId: string | null
  callers: Record<string, CallerHit[] | 'loading'>
  onOpenLink: (parent: PlacedCard, link: CardLink) => void
  onOpenCaller: (parent: PlacedCard, hit: CallerHit) => void
  onToggleCallers: (placed: PlacedCard) => void
  onClose: (id: string) => void
  onMoveCard: (id: string, x: number, y: number) => void
  viewportRef: React.RefObject<HTMLDivElement | null>
}

type Drag =
  | { kind: 'pan'; startX: number; startY: number; ox: number; oy: number }
  | { kind: 'card'; id: string; startX: number; startY: number; ox: number; oy: number }

export function Canvas({
  cards, view, setView, focusId, callers,
  onOpenLink, onOpenCaller, onToggleCallers, onClose, onMoveCard, viewportRef,
}: Props) {
  const drag = useRef<Drag | null>(null)

  // Wheel must be a non-passive native listener, or the browser scrolls the page
  // out from under the canvas before preventDefault can take effect.
  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      if (event.ctrlKey || event.metaKey) {
        setView((v) => {
          const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * Math.exp(-event.deltaY / 400)))
          const wx = (px - v.x) / v.scale
          const wy = (py - v.y) / v.scale
          return { scale: next, x: px - wx * next, y: py - wy * next }
        })
      } else {
        setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }))
      }
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [setView, viewportRef])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.card')) return
    viewportRef.current?.setPointerCapture(event.pointerId)
    drag.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, ox: view.x, oy: view.y }
  }, [view.x, view.y, viewportRef])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = event.clientX - d.startX
    const dy = event.clientY - d.startY
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
    else onMoveCard(d.id, d.ox + dx / view.scale, d.oy + dy / view.scale)
  }, [onMoveCard, setView, view.scale])

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null
    if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId)
    }
  }, [viewportRef])

  const grab = useCallback((placed: PlacedCard) => (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    viewportRef.current?.setPointerCapture(event.pointerId)
    drag.current = {
      kind: 'card', id: placed.card.id,
      startX: event.clientX, startY: event.clientY, ox: placed.x, oy: placed.y,
    }
  }, [viewportRef])

  const byId = new Map(cards.map((c) => [c.card.id, c]))
  const openIds = new Set(cards.map((c) => c.card.id))

  // The wire layer needs a real, non-zero viewport: an outermost <svg> sized 0×0
  // is not painted at all, even though its paths still report a bounding box.
  // Sizing it to the cards' extent keeps world coordinates usable in the paths.
  const extent = bounds(cards)
  const pad = 240
  const frame = extent
    ? { x: extent.x - pad, y: extent.y - pad, w: extent.w + pad * 2, h: extent.h + pad * 2 }
    : { x: 0, y: 0, w: 1, h: 1 }

  return (
    <div
      className="viewport"
      ref={viewportRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="world"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <svg
          className="wires"
          aria-hidden="true"
          style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
          viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`}
        >
          {cards.map((child) => {
            const parent = child.parentId ? byId.get(child.parentId) : undefined
            if (!parent) return null
            const rightward = child.x >= parent.x
            const x1 = rightward ? parent.x + CARD_W : parent.x
            const y1 = parent.y + child.anchorOffset
            const x2 = rightward ? child.x : child.x + CARD_W
            const y2 = child.y + HEADER_H / 2
            const bend = Math.max(40, Math.abs(x2 - x1) * 0.4) * (rightward ? 1 : -1)
            return (
              <path
                key={child.card.id}
                className={focusId === child.card.id ? 'wire lit' : 'wire'}
                d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
              />
            )
          })}
        </svg>

        {cards.map((placed) => (
          <CardView
            key={placed.card.id}
            placed={placed}
            focused={focusId === placed.card.id}
            openIds={openIds}
            callers={callers[placed.card.id] ?? null}
            onOpenLink={(link) => onOpenLink(placed, link)}
            onOpenCaller={(hit) => onOpenCaller(placed, hit)}
            onToggleCallers={() => onToggleCallers(placed)}
            onClose={() => onClose(placed.card.id)}
            onGrab={grab(placed)}
          />
        ))}
      </div>
    </div>
  )
}
