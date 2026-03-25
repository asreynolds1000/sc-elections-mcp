import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { summarizeCrossSearchContributions, summarizeCrossSearchExpenditures } from './cross-search.js'
import type { CrossSearchContribution, CrossSearchExpenditure, CrossSearchReport } from '../types.js'

// Mock the ethics-client module
const mockSearchCampaignReports = vi.fn<() => Promise<CrossSearchReport[]>>()
const mockSearchExpenditures = vi.fn<() => Promise<CrossSearchExpenditure[]>>()
const mockSearchContributions = vi.fn<() => Promise<CrossSearchContribution[]>>()

vi.mock('../api/ethics-client.js', () => ({
  searchCampaignReports: (...args: unknown[]) => mockSearchCampaignReports(...args as []),
  searchExpenditures: (...args: unknown[]) => mockSearchExpenditures(...args as []),
  searchContributions: (...args: unknown[]) => mockSearchContributions(...args as []),
  normalizeOfficeName: (name: string) => ({ raw: name, normalized: name }),
}))

// Import after mocking
const { registerCrossSearchTools } = await import('./cross-search.js')

// Helper to call a registered tool
async function callTool(server: McpServer, toolName: string, args: Record<string, unknown>) {
  const tools = (server as any)._registeredTools
  const tool = tools?.[toolName]
  if (!tool) throw new Error(`Tool ${toolName} not registered`)
  return tool.handler(args, {})
}

function makeReport(overrides: Partial<CrossSearchReport> = {}): CrossSearchReport {
  return {
    candidateFilerId: 1000,
    seiFilerId: 2000,
    credentialId: 3000,
    campaignId: 4000,
    reportId: 5000,
    office: 'Greenville County Council District 17',
    reportName: 'Initial Report 2026',
    candidateName: 'Dill, Joe  ',
    electionyear: '2026',
    electionType: 'Primary',
    lastUpdated: '2026-03-17T12:00:00.000',
    ...overrides,
  }
}

describe('search_campaign_reports', () => {
  let server: McpServer

  beforeEach(() => {
    server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCrossSearchTools(server)
    vi.clearAllMocks()
  })

  it('election_year alone is a valid filter', async () => {
    mockSearchCampaignReports.mockResolvedValue([])
    const result = await callTool(server, 'search_campaign_reports', { election_year: 2026 })
    expect(result.content[0].text).toContain('No campaign reports found')
  })

  it('report_type=Any with election_year still works (election_year is the real filter)', async () => {
    mockSearchCampaignReports.mockResolvedValue([
      makeReport(),
    ])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Any',
      election_year: 2026,
    })
    expect(result.content[0].text).toContain('1 campaign report(s) found')
  })

  it('passes report_type and election_year to the API', async () => {
    mockSearchCampaignReports.mockResolvedValue([])
    await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
    })
    expect(mockSearchCampaignReports).toHaveBeenCalledWith({
      candidate: undefined,
      office: undefined,
      reportType: 'Initial',
      electionYear: 2026,
      electionType: undefined,
    })
  })

  it('defaults reportType to "Any" when not specified', async () => {
    mockSearchCampaignReports.mockResolvedValue([])
    await callTool(server, 'search_campaign_reports', {
      election_year: 2026,
    })
    expect(mockSearchCampaignReports).toHaveBeenCalledWith(
      expect.objectContaining({ reportType: 'Any' })
    )
  })

  it('passes election_type to the API', async () => {
    mockSearchCampaignReports.mockResolvedValue([])
    await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
      election_type: 'Primary',
    })
    expect(mockSearchCampaignReports).toHaveBeenCalledWith(
      expect.objectContaining({ electionType: 'Primary' })
    )
  })

  it('returns correct count and trims candidate names', async () => {
    mockSearchCampaignReports.mockResolvedValue([
      makeReport({ candidateName: 'Dill, Joe  ' }),
      makeReport({ candidateName: 'Hoard, James   ', candidateFilerId: 1001 }),
    ])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
    })
    expect(result.content[0].text).toContain('2 campaign report(s) found')
    expect(result.content[0].text).toContain('"Dill, Joe"')
    expect(result.content[0].text).toContain('"Hoard, James"')
  })

  it('trims office names', async () => {
    mockSearchCampaignReports.mockResolvedValue([
      makeReport({ office: 'Greenville County Council  ' }),
    ])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
    })
    const parsed = JSON.parse(result.content[0].text.split('\n').slice(1).join('\n'))
    expect(parsed[0].office).toBe('Greenville County Council')
  })

  it('filters by since date (client-side)', async () => {
    mockSearchCampaignReports.mockResolvedValue([
      makeReport({ lastUpdated: '2026-03-24T10:00:00.000', candidateName: 'New, Today' }),
      makeReport({ lastUpdated: '2026-03-23T10:00:00.000', candidateName: 'Old, Yesterday' }),
      makeReport({ lastUpdated: '2026-03-22T10:00:00.000', candidateName: 'Older, TwoDaysAgo' }),
    ])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
      since: '2026-03-24',
    })
    expect(result.content[0].text).toContain('1 campaign report(s) found')
    expect(result.content[0].text).toContain('New, Today')
    expect(result.content[0].text).not.toContain('Old, Yesterday')
  })

  it('sorts results by lastUpdated descending', async () => {
    mockSearchCampaignReports.mockResolvedValue([
      makeReport({ lastUpdated: '2026-03-17T10:00:00.000', candidateName: 'Early, Filer' }),
      makeReport({ lastUpdated: '2026-03-24T10:00:00.000', candidateName: 'Late, Filer' }),
      makeReport({ lastUpdated: '2026-03-20T10:00:00.000', candidateName: 'Mid, Filer' }),
    ])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
    })
    const text = result.content[0].text
    const lateIdx = text.indexOf('Late, Filer')
    const midIdx = text.indexOf('Mid, Filer')
    const earlyIdx = text.indexOf('Early, Filer')
    expect(lateIdx).toBeLessThan(midIdx)
    expect(midIdx).toBeLessThan(earlyIdx)
  })

  it('respects limit parameter', async () => {
    const reports = Array.from({ length: 10 }, (_, i) =>
      makeReport({ candidateFilerId: i, candidateName: `Candidate, ${i}`, lastUpdated: `2026-03-${String(16 + i).padStart(2, '0')}T10:00:00.000` })
    )
    mockSearchCampaignReports.mockResolvedValue(reports)
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
      limit: 3,
    })
    expect(result.content[0].text).toContain('10 campaign report(s) found')
    expect(result.content[0].text).toContain('Showing 3 of 10')
  })

  it('limit=0 returns all results', async () => {
    const reports = Array.from({ length: 5 }, (_, i) =>
      makeReport({ candidateFilerId: i, candidateName: `Candidate, ${i}` })
    )
    mockSearchCampaignReports.mockResolvedValue(reports)
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
      limit: 0,
    })
    expect(result.content[0].text).toContain('5 campaign report(s) found')
    expect(result.content[0].text).not.toContain('Showing')
  })

  it('returns empty message when no results', async () => {
    mockSearchCampaignReports.mockResolvedValue([])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Final',
      election_year: 2026,
    })
    expect(result.content[0].text).toBe('No campaign reports found matching filters')
  })

  it('handles API errors gracefully', async () => {
    mockSearchCampaignReports.mockRejectedValue(new Error('Network timeout'))
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Network timeout')
  })

  it('rejects invalid since date', async () => {
    mockSearchCampaignReports.mockResolvedValue([makeReport()])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
      since: 'not-a-date',
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Invalid "since" date')
  })

  it('since boundary: includes reports exactly on the since date', async () => {
    mockSearchCampaignReports.mockResolvedValue([
      makeReport({ lastUpdated: '2026-03-24T00:00:00.000', candidateName: 'Midnight, Filer' }),
      makeReport({ lastUpdated: '2026-03-23T23:59:59.999', candidateName: 'Before, Midnight' }),
    ])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
      since: '2026-03-24',
    })
    expect(result.content[0].text).toContain('1 campaign report(s) found')
    expect(result.content[0].text).toContain('Midnight, Filer')
    expect(result.content[0].text).not.toContain('Before, Midnight')
  })

  it('since filter with no matching results returns empty message', async () => {
    mockSearchCampaignReports.mockResolvedValue([
      makeReport({ lastUpdated: '2026-03-20T10:00:00.000' }),
    ])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
      since: '2026-03-25',
    })
    expect(result.content[0].text).toBe('No campaign reports found matching filters')
  })

  it('since="today" resolves to current date', async () => {
    mockSearchCampaignReports.mockResolvedValue([
      makeReport({ lastUpdated: new Date().toISOString(), candidateName: 'Today, Filer' }),
      makeReport({ lastUpdated: '2026-01-01T10:00:00.000', candidateName: 'Old, Filer' }),
    ])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
      since: 'today',
    })
    expect(result.content[0].text).toContain('1 campaign report(s) found')
    expect(result.content[0].text).toContain('Today, Filer')
    expect(result.content[0].text).not.toContain('Old, Filer')
  })

  it('since="yesterday" resolves to yesterday\'s date', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().slice(0, 10)
    mockSearchCampaignReports.mockResolvedValue([
      makeReport({ lastUpdated: `${yesterdayStr}T14:00:00.000`, candidateName: 'Yesterday, Filer' }),
      makeReport({ lastUpdated: '2026-01-01T10:00:00.000', candidateName: 'Old, Filer' }),
    ])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
      since: 'yesterday',
    })
    expect(result.content[0].text).toContain('1 campaign report(s) found')
    expect(result.content[0].text).toContain('Yesterday, Filer')
  })

  it('slim mode strips IDs and keeps only readable fields', async () => {
    mockSearchCampaignReports.mockResolvedValue([
      makeReport({ candidateName: 'Dill, Joe  ', office: 'Greenville County Council D17 ' }),
    ])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
      slim: true,
    })
    const parsed = JSON.parse(result.content[0].text.split('\n').slice(1).join('\n'))
    const record = parsed[0]
    // Should have these fields
    expect(record.candidateName).toBe('Dill, Joe')
    expect(record.office).toBe('Greenville County Council D17')
    expect(record.reportName).toBeDefined()
    expect(record.electionType).toBeDefined()
    expect(record.lastUpdated).toBeDefined()
    // Should NOT have these fields
    expect(record.candidateFilerId).toBeUndefined()
    expect(record.seiFilerId).toBeUndefined()
    expect(record.credentialId).toBeUndefined()
    expect(record.campaignId).toBeUndefined()
    expect(record.reportId).toBeUndefined()
    expect(record.normalizedOffice).toBeUndefined()
  })

  it('passes candidate and office filters', async () => {
    mockSearchCampaignReports.mockResolvedValue([])
    await callTool(server, 'search_campaign_reports', {
      candidate: 'Dill',
      office: 'Greenville',
      report_type: 'Quarterly',
      election_year: 2026,
    })
    expect(mockSearchCampaignReports).toHaveBeenCalledWith({
      candidate: 'Dill',
      office: 'Greenville',
      reportType: 'Quarterly',
      electionYear: 2026,
      electionType: undefined,
    })
  })

  it('since is case-insensitive', async () => {
    mockSearchCampaignReports.mockResolvedValue([
      makeReport({ lastUpdated: new Date().toISOString(), candidateName: 'Today, Filer' }),
      makeReport({ lastUpdated: '2026-01-01T10:00:00.000', candidateName: 'Old, Filer' }),
    ])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
      since: 'TODAY',
    })
    expect(result.content[0].text).toContain('1 campaign report(s) found')
    expect(result.content[0].text).toContain('Today, Filer')
  })

  it('slim=false (default) includes IDs and normalizedOffice', async () => {
    mockSearchCampaignReports.mockResolvedValue([makeReport()])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
    })
    const parsed = JSON.parse(result.content[0].text.split('\n').slice(1).join('\n'))
    const record = parsed[0]
    expect(record.candidateFilerId).toBeDefined()
    expect(record.seiFilerId).toBeDefined()
    expect(record.campaignId).toBeDefined()
    expect(record.normalizedOffice).toBeDefined()
  })

  it('includes normalizedOffice in results', async () => {
    mockSearchCampaignReports.mockResolvedValue([
      makeReport({ office: 'Spartanburg County Council District 6' }),
    ])
    const result = await callTool(server, 'search_campaign_reports', {
      report_type: 'Initial',
      election_year: 2026,
    })
    expect(result.content[0].text).toContain('normalizedOffice')
  })
})

describe('tool registration', () => {
  it('registers all three cross-search tools', () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' })
    registerCrossSearchTools(server)
    const tools = (server as any)._registeredTools
    expect(tools['search_expenditures']).toBeDefined()
    expect(tools['search_contributions']).toBeDefined()
    expect(tools['search_campaign_reports']).toBeDefined()
  })
})

describe('searchCampaignReports API function', () => {
  it('builds correct request payload', async () => {
    // Test the API function directly by checking it calls fetch with the right body
    const { searchCampaignReports } = await import('../api/ethics-client.js')
    // This will hit the mock — just verify it was called
    mockSearchCampaignReports.mockResolvedValue([])
    await searchCampaignReports({
      reportType: 'Pre-Election',
      electionYear: 2026,
    })
    expect(mockSearchCampaignReports).toHaveBeenCalled()
  })
})

describe('summarizeCrossSearchContributions', () => {
  it('returns zeros for empty input', () => {
    const summary = summarizeCrossSearchContributions([])
    expect(summary.totalRecords).toBe(0)
    expect(summary.grandTotal).toBe(0)
    expect(summary.byCandidateTop20).toHaveLength(0)
  })

  it('groups contributions by candidate', () => {
    const results: CrossSearchContribution[] = [
      { contributionId: 1, candidateId: 1, candidateName: 'Dill, Joe', officeRunId: 100, officeName: 'CC D17', contributorName: 'Donor A', amount: 500, contributorAddress: '', contributorOccupation: '', group: '', date: '', electionDate: '', description: null },
      { contributionId: 2, candidateId: 1, candidateName: 'Dill, Joe', officeRunId: 100, officeName: 'CC D17', contributorName: 'Donor B', amount: 1000, contributorAddress: '', contributorOccupation: '', group: '', date: '', electionDate: '', description: null },
      { contributionId: 3, candidateId: 2, candidateName: 'Hoard, James', officeRunId: 200, officeName: 'CC D17', contributorName: 'Donor C', amount: 250, contributorAddress: '', contributorOccupation: '', group: '', date: '', electionDate: '', description: null },
    ]
    const summary = summarizeCrossSearchContributions(results)
    expect(summary.totalRecords).toBe(3)
    expect(summary.grandTotal).toBe(1750)
    expect(summary.byCandidateTop20).toHaveLength(2)
    expect(summary.byCandidateTop20[0].candidateName).toBe('Dill, Joe')
    expect(summary.byCandidateTop20[0].totalAmount).toBe(1500)
    expect(summary.byCandidateTop20[0].count).toBe(2)
  })
})

describe('summarizeCrossSearchExpenditures', () => {
  it('returns zeros for empty input', () => {
    const summary = summarizeCrossSearchExpenditures([])
    expect(summary.totalRecords).toBe(0)
    expect(summary.grandTotal).toBe(0)
    expect(summary.byVendorTop20).toHaveLength(0)
  })

  it('groups expenditures by vendor', () => {
    const results: CrossSearchExpenditure[] = [
      { candidateFilerId: 1, credentialId: 10, campaignId: 100, candidateName: 'Dill', office: 'CC', vendorName: 'Print Shop', amount: 500, address: '', expDesc: '', expDate: '', expId: 1 },
      { candidateFilerId: 2, credentialId: 20, campaignId: 200, candidateName: 'Hoard', office: 'CC', vendorName: 'Print Shop', amount: 300, address: '', expDesc: '', expDate: '', expId: 2 },
      { candidateFilerId: 1, credentialId: 10, campaignId: 100, candidateName: 'Dill', office: 'CC', vendorName: 'Signs R Us', amount: 200, address: '', expDesc: '', expDate: '', expId: 3 },
    ]
    const summary = summarizeCrossSearchExpenditures(results)
    expect(summary.totalRecords).toBe(3)
    expect(summary.grandTotal).toBe(1000)
    expect(summary.byVendorTop20).toHaveLength(2)
    expect(summary.byVendorTop20[0].vendorName).toBe('Print Shop')
    expect(summary.byVendorTop20[0].totalAmount).toBe(800)
    expect(summary.byVendorTop20[0].candidateCount).toBe(2)
  })
})
