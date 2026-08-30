import { describe, expect, it } from 'vitest'
import { CARD_W, GAP_X, GAP_Y, HEADER_H, bounds, cardHeight, offsetY, panToCard, place } from './layout'
import type { PlacedCard } from './layout'
import type { Card } from '../engine/types'

function card(lines: number, id = 'c'): Card {
  return {
    id, file: '/a.ts', name: id, kind: 'function', containerName: null,
    text: Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n'),
    span: { start: 0, length: 0 }, pos: 0, startLine: 1, tokens: [], links: [],
  }
}

const placed = (c: Card, x: number, y: number, column: number): PlacedCard =>
  ({ card: c, x, y, column, parentId: null, anchorOffset: 0 })

describe('cardHeight', () => {
  it('grows with line count', () => {
    expect(cardHeight(card(10))).toBeGreaterThan(cardHeight(card(3)))
  })

  it('caps very long declarations so one card cannot fill the canvas', () => {
    expect(cardHeight(card(5000))).toBe(cardHeight(card(4000)))
  })
})

describe('place', () => {
  it('puts a root card at the origin', () => {
    expect(place([], card(5), null, 0)).toEqual({ x: 0, y: 0, column: 0 })
  })

  it('puts a child one column to the right', () => {
    const parent = placed(card(5), 0, 0, 0)
    expect(place([parent], card(5), parent, HEADER_H).column).toBe(1)
    expect(place([parent], card(5), parent, HEADER_H).x).toBe(CARD_W + GAP_X)
  })

  it('lines a child up with the call site that opened it', () => {
    const parent = placed(card(20), 0, 100, 0)
    const { y } = place([parent], card(5), parent, HEADER_H + 60)
    expect(y).toBe(160)
  })

  it('slides a child below an existing card in the same column', () => {
    const parent = placed(card(20), 0, 0, 0)
    const sibling = placed(card(5), CARD_W + GAP_X, 0, 1)
    const { y } = place([parent, sibling], card(5), parent, HEADER_H)
    expect(y).toBeGreaterThanOrEqual(cardHeight(sibling.card) + GAP_Y)
  })

  it('puts a caller one column to the left', () => {
    const parent = placed(card(5), 0, 0, 0)
    const p = place([parent], card(5), parent, HEADER_H, -1)
    expect(p.column).toBe(-1)
    expect(p.x).toBe(-(CARD_W + GAP_X))
  })

  it('ignores cards in other columns', () => {
    const parent = placed(card(20), 0, 0, 0)
    const faraway = placed(card(40), 0, 0, 5)
    expect(place([parent, faraway], card(5), parent, HEADER_H).y).toBe(0)
  })

  it('stacks a run of siblings without overlap', () => {
    const parent = placed(card(30), 0, 0, 0)
    const cards: PlacedCard[] = [parent]
    for (let i = 0; i < 4; i++) {
      const c = card(6, `k${i}`)
      const p = place(cards, c, parent, HEADER_H)
      cards.push({ card: c, ...p, parentId: parent.card.id, anchorOffset: 0 })
    }
    const column = cards.filter((c) => c.column === 1).sort((a, b) => a.y - b.y)
    for (let i = 1; i < column.length; i++) {
      expect(column[i].y).toBeGreaterThanOrEqual(column[i - 1].y + cardHeight(column[i - 1].card))
    }
  })
})

describe('offsetY', () => {
  it('grows with the line the offset falls on', () => {
    const c = card(20)
    const firstLine = offsetY(c, 0)
    const laterLine = offsetY(c, c.text.indexOf('line 5'))
    expect(laterLine).toBeGreaterThan(firstLine)
  })

  it('stays inside the card even for an offset past the visible cap', () => {
    const c = card(5000)
    expect(offsetY(c, c.text.length - 1)).toBeLessThanOrEqual(cardHeight(c))
  })
})

describe('panToCard', () => {
  const view = { x: 0, y: 0, scale: 1 }

  it('leaves a card that is already in view alone', () => {
    expect(panToCard(view, placed(card(5), 200, 200, 0), 1400, 900)).toEqual(view)
  })

  it('pans right for a card off the left edge', () => {
    expect(panToCard(view, placed(card(5), -400, 0, 0), 1400, 900).x).toBeGreaterThan(0)
  })

  it('pans left for a card past the right edge', () => {
    expect(panToCard(view, placed(card(5), 1600, 0, 0), 1400, 900).x).toBeLessThan(0)
  })

  it('pans up for a card below the viewport', () => {
    expect(panToCard(view, placed(card(20), 0, 1200, 0), 1400, 900).y).toBeLessThan(0)
  })

  it('never pushes a card off the opposite edge to fit it', () => {
    // A card taller than the viewport cannot fit; its top must stay reachable.
    const tall = placed(card(200), 0, 400, 0)
    const next = panToCard(view, tall, 1400, 500)
    expect(tall.y * next.scale + next.y).toBeLessThanOrEqual(32)
  })

  it('nudges a card flush against an edge inward by the margin', () => {
    expect(panToCard(view, placed(card(5), 0, 0, 0), 1400, 900)).toEqual({ x: 32, y: 32, scale: 1 })
  })

  it('accounts for zoom when deciding what is visible', () => {
    const zoomed = { x: 0, y: 0, scale: 0.5 }
    // At half scale this card spans x 530–800, comfortably inside a 1400px viewport;
    // at scale 1 its right edge would be past it and force a pan.
    expect(panToCard(zoomed, placed(card(5), 1060, 200, 0), 1400, 900)).toEqual(zoomed)
    expect(panToCard(view, placed(card(5), 1060, 200, 0), 1400, 900).x).toBeLessThan(0)
  })
})

describe('bounds', () => {
  it('is null with nothing placed', () => {
    expect(bounds([])).toBeNull()
  })

  it('covers every card', () => {
    const b = bounds([placed(card(5), 0, 0, 0), placed(card(5), 600, 300, 1)])!
    expect(b.x).toBe(0)
    expect(b.y).toBe(0)
    expect(b.w).toBe(600 + CARD_W)
    expect(b.h).toBe(300 + cardHeight(card(5)))
  })
})
