import { describe, it, expect } from 'vitest'
import { tokenMatch } from '../src/api/ethics-client.js'

describe('tokenMatch', () => {
  it('matches tokens regardless of word order', () => {
    expect(tokenMatch('House District 13', 'District 13 House')).toBe(true)
  })

  it('matches partial token sets', () => {
    expect(tokenMatch('District 13', 'District 13 House')).toBe(true)
    expect(tokenMatch('District 13', 'District 13 Senate')).toBe(true)
  })

  it('does NOT match via substring — requires exact word match', () => {
    // "1" should not match "10", "13", etc.
    expect(tokenMatch('District 1', 'District 10 House')).toBe(false)
    expect(tokenMatch('District 1', 'District 13 House')).toBe(false)
    // But "District 1" should match "District 1 House"
    expect(tokenMatch('District 1', 'District 1 House')).toBe(true)
  })

  it('matches across comma-separated segments', () => {
    expect(tokenMatch('Greenville County Council', 'Other Office, Greenville County Council District 17')).toBe(true)
  })

  it('ignores standalone "Other Office" segments', () => {
    expect(tokenMatch('District 13 House', 'District 13 House, Other Office')).toBe(true)
    expect(tokenMatch('District 13 House', 'Other Office, District 13 House')).toBe(true)
  })

  it('does not match different county names', () => {
    expect(tokenMatch('Greenville Sheriff', 'Greenwood Sheriff, Mccormick Sheriff')).toBe(false)
  })

  it('matches single token', () => {
    expect(tokenMatch('Sheriff', 'Greenville Sheriff')).toBe(true)
    expect(tokenMatch('Sheriff', 'Other Office, Greenville Sheriff')).toBe(true)
  })

  it('returns false for empty query', () => {
    expect(tokenMatch('', 'District 13 House')).toBe(false)
  })

  it('returns false for empty text', () => {
    expect(tokenMatch('District 13', '')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(tokenMatch('HOUSE DISTRICT 13', 'District 13 House')).toBe(true)
    expect(tokenMatch('house district 13', 'DISTRICT 13 HOUSE')).toBe(true)
  })

  it('handles real messy Ethics data patterns', () => {
    // Multi-office with House district embedded
    expect(tokenMatch('District 14 House', 'Laurens County Council, District 14 House')).toBe(true)
    // Multiple offices with "Other Office"
    expect(tokenMatch('District 8 Senate', 'District 8 Senate, Other Office, Greenville Probate Judge')).toBe(true)
    // School board + county council combo
    expect(tokenMatch('Spartanburg County Council', 'Spartanburg #2 School Board, Spartanburg County Council District 2, Spartanburg County Council')).toBe(true)
  })
})
