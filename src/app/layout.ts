import type { Card } from '../engine/types'

export const CARD_W = 540
export const GAP_X = 72
export const GAP_Y = 20
export const LINE_H = 19
export const HEADER_H = 36
export const PAD_Y = 8
export const MAX_H = 460

/** Canvas pan offset and zoom. */
export interface View {
  x: number
  y: number
  scale: number
}

export interface PlacedCard {
  card: Card
  x: number
  y: number
  /** Distance from the card the exploration started at. */
  column: number
  parentId: string | null
  /** Where inside the parent the connector starts, so it follows a dragged card. */
  anchorOffset: number
}

export function cardHeight(card: Card): number {
  const lines = card.text.split('\n').length
  return Math.min(MAX_H, HEADER_H + PAD_Y * 2 + lines * LINE_H)
}

/** Vertical offset of a source offset within a card, for anchoring connectors. */
export function offsetY(card: Card, textOffset: number): number {
  const line = card.text.slice(0, textOffset).split('\n').length - 1
  const y = HEADER_H + PAD_Y + line * LINE_H + LINE_H / 2
  return Math.min(y, cardHeight(card) - PAD_Y)
}

/**
 * Positions a new card one column from its parent, level with the call site that
 * opened it, then slides it down past anything already in that column.
 *
 * Callees go right, which is the direction the code reads; callers go left, so
 * a chain assembled from either end stays in call order across the canvas.
 */
export function place(
  existing: PlacedCard[],
  card: Card,
  parent: PlacedCard | null,
  anchorY: number,
  direction: 1 | -1 = 1,
): { x: number; y: number; column: number } {
  const column = parent ? parent.column + direction : 0
  const x = column * (CARD_W + GAP_X)
  const height = cardHeight(card)
  const preferred = parent ? parent.y + anchorY - HEADER_H : 0

  const neighbours = existing
    .filter((c) => c.column === column)
    .map((c) => ({ top: c.y, bottom: c.y + cardHeight(c.card) }))
    .sort((a, b) => a.top - b.top)

  let y = preferred
  let moved = true
  while (moved) {
    moved = false
    for (const n of neighbours) {
      if (y < n.bottom + GAP_Y && y + height + GAP_Y > n.top) {
        y = n.bottom + GAP_Y
        moved = true
      }
    }
  }
  return { x, y, column }
}

/** Pan so a card is fully visible, moving as little as possible. */
export function panToCard(view: View, placed: PlacedCard, width: number, height: number): View {
  const margin = 32
  const left = placed.x * view.scale + view.x
  const top = placed.y * view.scale + view.y
  const right = left + CARD_W * view.scale
  const bottom = top + cardHeight(placed.card) * view.scale

  let { x, y } = view
  if (left < margin) x += margin - left
  else if (right > width - margin) x -= Math.min(right - (width - margin), left - margin)
  if (top < margin) y += margin - top
  else if (bottom > height - margin) y -= Math.min(bottom - (height - margin), top - margin)
  return { ...view, x, y }
}

/** Bounding box of every placed card, for zoom-to-fit. */
export function bounds(cards: PlacedCard[]): { x: number; y: number; w: number; h: number } | null {
  if (!cards.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of cards) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x + CARD_W)
    maxY = Math.max(maxY, c.y + cardHeight(c.card))
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
