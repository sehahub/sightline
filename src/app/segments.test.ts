import { describe, expect, it } from 'vitest'
import { layoutLines } from './segments'
import type { Card, CardLink, Token } from '../engine/types'

function card(text: string, tokens: Token[] = [], links: CardLink[] = [], startLine = 1): Card {
  return {
    id: 'x', file: '/a.ts', name: 'x', kind: 'function', containerName: null,
    text, span: { start: 0, length: text.length }, pos: 0, startLine, tokens, links,
  }
}

function link(start: number, length: number, name: string): CardLink {
  return { start, length, name, role: 'call', target: { file: '/b.ts', pos: 0 }, external: false, local: false }
}

const joined = (c: Card) => layoutLines(c).map((l) => l.segments.map((s) => s.text).join(''))

describe('layoutLines', () => {
  it('reproduces the source text exactly', () => {
    const text = 'const a = 1\nreturn a + 2\n'
    const c = card(text, [{ start: 0, length: 5, cls: 'kw' }], [link(6, 1, 'a')])
    expect(joined(c).join('\n')).toBe(text)
  })

  it('numbers lines from the declaration start line', () => {
    const lines = layoutLines(card('a\nb\nc', [], [], 42))
    expect(lines.map((l) => l.no)).toEqual([42, 43, 44])
  })

  it('keeps an identifier clickable even when it is also highlighted', () => {
    // `Grid` is classified as a type *and* is a navigable link.
    const c = card('new Grid()', [{ start: 4, length: 4, cls: 'type' }], [link(4, 4, 'Grid')])
    const segs = layoutLines(c)[0].segments
    const grid = segs.find((s) => s.text === 'Grid')
    expect(grid?.link?.name).toBe('Grid')
  })

  it('clips a highlight token that only partly overlaps a link', () => {
    const c = card('abcdef', [{ start: 0, length: 6, cls: 'kw' }], [link(2, 2, 'cd')])
    const segs = layoutLines(c)[0].segments
    expect(segs.map((s) => [s.text, s.cls, !!s.link])).toEqual([
      ['ab', 'kw', false],
      ['cd', 'call', true],
      ['ef', 'kw', false],
    ])
  })

  it('covers gaps between tokens with plain text', () => {
    const c = card('let x = y', [{ start: 0, length: 3, cls: 'kw' }])
    expect(joined(c)).toEqual(['let x = y'])
    expect(layoutLines(c)[0].segments.some((s) => s.cls === null)).toBe(true)
  })

  it('splits a multi-line token across lines', () => {
    const c = card('/* a\n b */ z', [{ start: 0, length: 10, cls: 'com' }])
    const lines = layoutLines(c)
    expect(lines).toHaveLength(2)
    expect(lines[0].segments.map((s) => s.text)).toEqual(['/* a'])
    expect(lines[1].segments.map((s) => s.text)).toEqual([' b */', ' z'])
  })

  it('emits an empty segment list for a blank line', () => {
    const lines = layoutLines(card('a\n\nb'))
    expect(lines[1].segments).toEqual([])
  })

  it('ignores a token that duplicates a link range', () => {
    const c = card('foo()', [{ start: 0, length: 3, cls: 'type' }], [link(0, 3, 'foo')])
    const segs = layoutLines(c)[0].segments
    expect(segs.filter((s) => s.text === 'foo')).toHaveLength(1)
  })

  it('handles a card with no tokens or links', () => {
    expect(joined(card('plain text'))).toEqual(['plain text'])
  })
})
