import { describe, it, expect } from 'vitest'
import { normalizeDonorName } from '../src/tools/overlap.js'

describe('normalizeDonorName', () => {
  it('flips "Last, First" to "first last"', () => {
    expect(normalizeDonorName('Smith, John')).toBe('john smith')
  })

  it('strips common suffixes at end of string', () => {
    // Suffix at end gets stripped before comma flip
    expect(normalizeDonorName('Doe, Jane MD')).toBe('jane doe')
    expect(normalizeDonorName('Jones, Bob III')).toBe('bob jones')
    // Suffix mid-string (before comma) is NOT stripped — it becomes part of the last name
    expect(normalizeDonorName('Smith Jr, John')).toBe('john smith jr')
  })

  it('normalizes case', () => {
    expect(normalizeDonorName('SMITH, JOHN')).toBe('john smith')
  })

  it('removes periods from initials', () => {
    // "Smith, J.R." → "smith, jr" → suffix "jr" stripped → "smith," → flip → "smith"
    expect(normalizeDonorName('Smith, J.R.')).toBe('smith')
    // When initials aren't a suffix match, they survive
    expect(normalizeDonorName('Smith, A.B.')).toBe('ab smith')
  })

  it('collapses whitespace', () => {
    expect(normalizeDonorName('  Smith ,  John   ')).toBe('john smith')
  })

  it('handles names without commas', () => {
    expect(normalizeDonorName('John Smith')).toBe('john smith')
  })

  it('handles multiple comma parts', () => {
    // "Smith, John, Jr" → suffix "jr" stripped → "smith, john," → flip → "john smith"
    expect(normalizeDonorName('Smith, John, Jr')).toBe('john smith')
  })
})
