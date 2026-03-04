import { describe, it, expect } from 'vitest'
import { dedupeKey } from '../src/api/ethics-client.js'
import type { EthicsFiler } from '../src/types.js'

function makeFiler(overrides: Partial<EthicsFiler> = {}): EthicsFiler {
  return {
    candidate: 'Smith, John',
    address: '123 Main St',
    lastSubmission: '01/01/2024',
    lastSeiReport: '',
    lastCampaignDisclosureReport: '',
    isAccountConsolidated: false,
    universalUserId: 0,
    candidateFilerId: 100,
    seiFilerId: 0,
    officeId: 1,
    officeName: 'Mayor',
    accountType: 0,
    percentageAccuracy: 100,
    ...overrides,
  }
}

describe('dedupeKey', () => {
  it('uses universalUserId when > 0', () => {
    const key = dedupeKey(makeFiler({ universalUserId: 42 }))
    expect(key).toBe('u-42')
  })

  it('falls back to name + seiFilerId when universalUserId is 0', () => {
    const key = dedupeKey(makeFiler({ universalUserId: 0, seiFilerId: 99, candidate: 'Doe, Jane' }))
    expect(key).toBe('ns-doe, jane-99')
  })

  it('falls back to name + address prefix when both IDs are 0', () => {
    const key = dedupeKey(makeFiler({ universalUserId: 0, seiFilerId: 0, candidate: 'Doe, Jane', address: '456 Oak Avenue Suite 200' }))
    expect(key).toBe('na-doe, jane-456 oak avenue suite')
  })

  it('handles missing candidate name gracefully', () => {
    const key = dedupeKey(makeFiler({ universalUserId: 0, seiFilerId: 0, candidate: '' }))
    expect(key).toMatch(/^na-/)
  })
})
