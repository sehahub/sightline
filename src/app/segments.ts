import type { Card, CardLink, TokenClass } from '../engine/types'

export interface Segment {
  text: string
  cls: TokenClass | null
  /** Set when this segment is a navigable identifier. */
  link: CardLink | null
}

export interface CodeLine {
  /** 1-based line number in the original file. */
  no: number
  segments: Segment[]
}

interface Range {
  start: number
  end: number
  cls: TokenClass | null
  link: CardLink | null
}

/**
 * Splits a card's source into styled, navigable runs, one list per line.
 *
 * Links win over highlight tokens where they overlap: an identifier that is
 * both classified (a class name, say) and navigable must stay clickable.
 */
export function layoutLines(card: Card): CodeLine[] {
  const ranges = buildRanges(card)
  const lines: CodeLine[] = []
  let current: Segment[] = []
  let lineNo = card.startLine

  for (const range of ranges) {
    const text = card.text.slice(range.start, range.end)
    const parts = text.split('\n')
    parts.forEach((part, i) => {
      if (i > 0) {
        lines.push({ no: lineNo, segments: current })
        current = []
        lineNo += 1
      }
      if (part) current.push({ text: part, cls: range.cls, link: range.link })
    })
  }
  lines.push({ no: lineNo, segments: current })
  return lines
}

function buildRanges(card: Card): Range[] {
  const links: Range[] = card.links
    .filter((l) => l.length > 0)
    .map((l) => ({ start: l.start, end: l.start + l.length, cls: roleClass(l), link: l }))
    .sort((a, b) => a.start - b.start)

  // Highlight tokens are clipped around links so the two never overlap.
  const tokens: Range[] = []
  for (const t of card.tokens) {
    let start = t.start
    const end = t.start + t.length
    for (const l of links) {
      if (l.end <= start || l.start >= end) continue
      if (l.start > start) tokens.push({ start, end: l.start, cls: t.cls, link: null })
      start = Math.max(start, l.end)
    }
    if (end > start) tokens.push({ start, end, cls: t.cls, link: null })
  }

  const marked = [...links, ...tokens].sort((a, b) => a.start - b.start || a.end - b.end)

  // Fill the gaps so the result covers the text exactly once, in order.
  const out: Range[] = []
  let cursor = 0
  for (const range of marked) {
    if (range.start < cursor) continue
    if (range.start > cursor) out.push({ start: cursor, end: range.start, cls: null, link: null })
    out.push(range)
    cursor = range.end
  }
  if (cursor < card.text.length) {
    out.push({ start: cursor, end: card.text.length, cls: null, link: null })
  }
  return out
}

function roleClass(link: CardLink): TokenClass {
  if (link.role === 'type') return 'type'
  return link.role === 'call' ? 'call' : 'var'
}
