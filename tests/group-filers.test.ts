import { describe, it, expect } from 'vitest'
import { groupFilersByPerson } from '../src/api/ethics-client.js'
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

describe('groupFilersByPerson', () => {
  it('groups duplicate filers into one entry with multiple offices', () => {
    const filers = [
      makeFiler({ universalUserId: 1, officeId: 1, officeName: 'Mayor', lastSubmission: '01/01/2024' }),
      makeFiler({ universalUserId: 1, officeId: 2, officeName: 'County Council', lastSubmission: '06/15/2023' }),
    ]
    const result = groupFilersByPerson(filers)
    expect(result).toHaveLength(1)
    expect(result[0].offices).toHaveLength(2)
    expect(result[0].offices.map(o => o.officeName)).toContain('Mayor')
    expect(result[0].offices.map(o => o.officeName)).toContain('County Council')
  })

  it('keeps the most recent candidateFilerId when merging', () => {
    const filers = [
      makeFiler({ universalUserId: 1, candidateFilerId: 100, lastSubmission: '01/01/2020' }),
      makeFiler({ universalUserId: 1, candidateFilerId: 200, lastSubmission: '06/15/2024' }),
    ]
    const result = groupFilersByPerson(filers)
    expect(result[0].candidateFilerId).toBe(200)
  })

  it('sorts groups by most recent submission descending', () => {
    const filers = [
      makeFiler({ universalUserId: 1, lastSubmission: '01/01/2020' }),
      makeFiler({ universalUserId: 2, candidate: 'Doe, Jane', lastSubmission: '06/15/2024' }),
    ]
    const result = groupFilersByPerson(filers)
    expect(result[0].candidate).toBe('Doe, Jane')
  })

  it('does not duplicate offices with the same officeId', () => {
    const filers = [
      makeFiler({ universalUserId: 1, officeId: 1, officeName: 'Mayor' }),
      makeFiler({ universalUserId: 1, officeId: 1, officeName: 'Mayor' }),
    ]
    const result = groupFilersByPerson(filers)
    expect(result[0].offices).toHaveLength(1)
  })

  it('returns empty array for empty input', () => {
    expect(groupFilersByPerson([])).toEqual([])
  })
})
