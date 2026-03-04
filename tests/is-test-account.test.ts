import { describe, it, expect } from 'vitest'
import { isTestAccount } from '../src/api/ethics-client.js'
import type { EthicsFiler } from '../src/types.js'

function makeFiler(overrides: Partial<EthicsFiler> = {}): EthicsFiler {
  return {
    candidate: 'Smith, John',
    address: '123 Main St',
    lastSubmission: '01/01/2024',
    lastSeiReport: '',
    lastCampaignDisclosureReport: '',
    isAccountConsolidated: false,
    universalUserId: 1,
    candidateFilerId: 100,
    seiFilerId: 200,
    officeId: 1,
    officeName: 'Mayor',
    accountType: 0,
    percentageAccuracy: 100,
    ...overrides,
  }
}

describe('isTestAccount', () => {
  it('detects "Test, Test" as test account', () => {
    expect(isTestAccount(makeFiler({ candidate: 'Test, Test' }))).toBe(true)
  })

  it('detects "Testing, Foo" as test account', () => {
    expect(isTestAccount(makeFiler({ candidate: 'Testing, Foo' }))).toBe(true)
  })

  it('detects 50+ comma-separated offices as test account', () => {
    const manyOffices = Array.from({ length: 55 }, (_, i) => `Office ${i}`).join(', ')
    expect(isTestAccount(makeFiler({ candidate: 'John Smith', officeName: manyOffices }))).toBe(true)
  })

  it('returns false for normal candidates', () => {
    expect(isTestAccount(makeFiler({ candidate: 'John Smith', officeName: 'Mayor' }))).toBe(false)
  })

  it('returns false for names containing "test" but not matching patterns', () => {
    expect(isTestAccount(makeFiler({ candidate: 'Tester, Jane' }))).toBe(false)
  })
})
