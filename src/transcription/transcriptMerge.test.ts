import { describe, expect, it } from 'vitest'
import { normalizeRough, pickBestTranscriptPair } from './transcriptMerge'

describe('normalizeRough', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeRough('  Foo   BAR\nbaz  ')).toBe('foo bar baz')
  })
})

describe('pickBestTranscriptPair', () => {
  it('returns the non-empty side', () => {
    expect(pickBestTranscriptPair('', 'only web')).toBe('only web')
    expect(pickBestTranscriptPair('only whisper', '')).toBe('only whisper')
  })

  it('returns whisper when normalized equal', () => {
    expect(pickBestTranscriptPair('Hello World', 'hello   world')).toBe('Hello World')
  })

  it('prefers longer transcript when prefixes align', () => {
    const w = 'the quick brown fox jumps'
    const s = 'the quick brown fox'
    expect(pickBestTranscriptPair(w, s)).toBe(w)
    expect(pickBestTranscriptPair(s, w)).toBe(w)
  })

  it('handles substring containment', () => {
    expect(pickBestTranscriptPair('alpha beta gamma delta', 'alpha beta')).toBe(
      'alpha beta gamma delta',
    )
  })

  it('prefers whisper when lengths are similar but strings diverge', () => {
    expect(pickBestTranscriptPair('aaaaaa', 'bbbbbb')).toBe('aaaaaa')
  })
})
