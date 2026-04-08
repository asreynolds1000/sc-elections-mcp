import { describe, it, expect } from 'vitest'
import { resolveCampaignContext } from '../src/api/ethics-client.js'
import type { CampaignSummary, CampaignOfficeReport } from '../src/types.js'

function makeOffice(overrides: Partial<CampaignOfficeReport> = {}): CampaignOfficeReport {
  return {
    filerId: 100,
    officeId: 1000,
    officeName: 'County Council',
    initialReportFiledDate: '2020-01-15T00:00:00',
    lastReportSubmitted: 'Quarter 1, 2026 Report',
    latestActivity: 'Report (April 01, 2026)',
    balance: 5000,
    officeClosedDate: null,
    contributions: 15000,
    ...overrides,
  }
}

describe('resolveCampaignContext', () => {
  it('resolves to the open campaign filerId, not the input candidateFilerId', () => {
    const summary: CampaignSummary = {
      name: 'Shaw, Steve',
      address: null,
      openReports: [
        makeOffice({ filerId: 27934, officeId: 45412, officeName: 'Greenville County Council' }),
      ],
      closedReports: [
        makeOffice({
          filerId: 50495, officeId: 74907, officeName: 'District 6 Senate',
          balance: 0, officeClosedDate: '2024-03-20T00:00:00',
        }),
      ],
    }
    // Pass the "wrong" candidateFilerId (50495 from search results)
    const result = resolveCampaignContext(summary, 50495)
    expect(result).not.toHaveProperty('error')
    if ('error' in result) throw new Error('unexpected error')
    // Should resolve to the open campaign's filerId (27934), not the input (50495)
    expect(result.resolvedFilerId).toBe(27934)
    expect(result.resolvedCampaignId).toBe(45412)
    expect(result.context.officeName).toBe('Greenville County Council')
    expect(result.context.campaignStatus).toBe('open')
  })

  it('prefers open campaign over closed when both have the same office name', () => {
    const summary: CampaignSummary = {
      name: 'Bradley, Richard',
      address: null,
      openReports: [
        makeOffice({ filerId: 44760, officeId: 71114, officeName: 'Greenville County Council District 26', balance: 8536 }),
      ],
      closedReports: [
        makeOffice({
          filerId: 57372, officeId: 79432, officeName: 'Greenville County Council District 26',
          balance: 0, officeClosedDate: '2026-04-06T00:00:00',
        }),
      ],
    }
    const result = resolveCampaignContext(summary, 57372)
    expect(result).not.toHaveProperty('error')
    if ('error' in result) throw new Error('unexpected error')
    expect(result.resolvedFilerId).toBe(44760)
    expect(result.resolvedCampaignId).toBe(71114)
  })

  it('returns error when no campaigns exist', () => {
    const summary: CampaignSummary = {
      name: null, address: null,
      openReports: [], closedReports: [],
    }
    const result = resolveCampaignContext(summary, 100)
    expect(result).toHaveProperty('error')
  })

  it('resolves by campaignId when explicitly provided', () => {
    const summary: CampaignSummary = {
      name: 'Test Person',
      address: null,
      openReports: [
        makeOffice({ filerId: 100, officeId: 1000, officeName: 'Mayor' }),
        makeOffice({ filerId: 200, officeId: 2000, officeName: 'County Council' }),
      ],
      closedReports: [],
    }
    const result = resolveCampaignContext(summary, 999, 2000)
    expect(result).not.toHaveProperty('error')
    if ('error' in result) throw new Error('unexpected error')
    expect(result.resolvedFilerId).toBe(200)
    expect(result.resolvedCampaignId).toBe(2000)
  })

  it('resolves by office hint when provided', () => {
    const summary: CampaignSummary = {
      name: 'Test Person',
      address: null,
      openReports: [
        makeOffice({ filerId: 100, officeId: 1000, officeName: 'Mayor' }),
        makeOffice({ filerId: 200, officeId: 2000, officeName: 'County Council' }),
      ],
      closedReports: [],
    }
    const result = resolveCampaignContext(summary, 999, undefined, 'County Council')
    expect(result).not.toHaveProperty('error')
    if ('error' in result) throw new Error('unexpected error')
    expect(result.resolvedFilerId).toBe(200)
    expect(result.context.officeName).toBe('County Council')
  })
})
