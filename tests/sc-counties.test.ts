import { describe, it, expect } from 'vitest'
import { resolveCountyCode, resolveCountyName, extractCountyFromAddress, extractCountyFromOfficeName } from '../src/data/sc-counties.js'

describe('resolveCountyCode', () => {
  it('resolves county name to code', () => {
    expect(resolveCountyCode('Greenville')).toBe('23')
    expect(resolveCountyCode('Spartanburg')).toBe('42')
    expect(resolveCountyCode('York')).toBe('46')
  })

  it('is case-insensitive', () => {
    expect(resolveCountyCode('greenville')).toBe('23')
    expect(resolveCountyCode('GREENVILLE')).toBe('23')
  })

  it('passes through numeric codes', () => {
    expect(resolveCountyCode('23')).toBe('23')
    expect(resolveCountyCode('1')).toBe('01')
  })

  it('returns undefined for unknown input', () => {
    expect(resolveCountyCode('Fakeville')).toBeUndefined()
    expect(resolveCountyCode('99')).toBeUndefined()
  })
})

describe('resolveCountyName', () => {
  it('resolves code to name', () => {
    expect(resolveCountyName('23')).toBe('Greenville')
    expect(resolveCountyName('42')).toBe('Spartanburg')
  })

  it('resolves name to canonical name', () => {
    expect(resolveCountyName('greenville')).toBe('Greenville')
    expect(resolveCountyName('mccormick')).toBe('McCormick')
  })

  it('returns undefined for unknown', () => {
    expect(resolveCountyName('Fakeville')).toBeUndefined()
  })
})

describe('extractCountyFromAddress', () => {
  it('extracts county from standard address format', () => {
    expect(extractCountyFromAddress('1629 Bypass 72 Ne Greenwood, SC 29649')).toBe('Greenwood')
    expect(extractCountyFromAddress('709 Southern Street Spartanburg, SC 29303')).toBe('Spartanburg')
  })

  it('handles comma between street and city', () => {
    expect(extractCountyFromAddress('4303 Old Buncombe Rd, Greenville, SC 29617')).toBe('Greenville')
  })

  it('handles PO Box addresses', () => {
    expect(extractCountyFromAddress('Po Box 22 Reidville, SC 29375')).toBe('Spartanburg')
  })

  it('handles multi-word city names', () => {
    expect(extractCountyFromAddress('PO Box 161944 Boiling Springs, SC 29316')).toBe('Spartanburg')
    expect(extractCountyFromAddress('123 Main St North Augusta, SC 29841')).toBe('Aiken')
  })

  it('returns undefined for unmapped cities', () => {
    expect(extractCountyFromAddress('123 Rural Route Nowhere, SC 29999')).toBeUndefined()
  })

  it('returns undefined for empty/null input', () => {
    expect(extractCountyFromAddress('')).toBeUndefined()
  })
})

describe('extractCountyFromOfficeName', () => {
  it('extracts county from standard office names', () => {
    expect(extractCountyFromOfficeName('Greenville County Council')).toBe('Greenville')
    expect(extractCountyFromOfficeName('Spartanburg Sheriff')).toBe('Spartanburg')
    expect(extractCountyFromOfficeName('Laurens Probate Judge')).toBe('Laurens')
  })

  it('extracts from multi-office comma-separated strings', () => {
    expect(extractCountyFromOfficeName('Other Office, Greenville County Council District 17')).toBe('Greenville')
    expect(extractCountyFromOfficeName('District 8 Senate, Other Office, Greenville Probate Judge')).toBe('Greenville')
  })

  it('returns undefined for offices without county names', () => {
    expect(extractCountyFromOfficeName('District 13 House')).toBeUndefined()
    expect(extractCountyFromOfficeName('Governor')).toBeUndefined()
    expect(extractCountyFromOfficeName('Other Office')).toBeUndefined()
  })

  it('distinguishes similar county names', () => {
    // "Greenville" should not match "Greenwood"
    expect(extractCountyFromOfficeName('Greenwood Sheriff')).toBe('Greenwood')
    expect(extractCountyFromOfficeName('Greenville Sheriff')).toBe('Greenville')
  })

  it('returns undefined for empty input', () => {
    expect(extractCountyFromOfficeName('')).toBeUndefined()
  })
})
