import type {
  EthicsFiler,
  FilerProfile,
  CampaignSummary,
  CampaignOfficeReport,
  CampaignReport,
  CampaignReportDetails,
  CampaignContribution,
  CampaignExpenditure,
  CampaignContext,
  ContributionSummary,
  ExpenditureSummary,
  NormalizedOffice,
  GroupedFiler,
  CrossSearchExpenditure,
  CrossSearchContribution,
  SeiReport,
  SeiReportBody,
  SeiDetails,
  OfficeFilerResult,
} from '../types.js'

const BASE = 'https://ethicsfiling.sc.gov/api'

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

// ============================================================
// Search & Lookup
// ============================================================

// Maps candidateFilerId → seiFilerId, populated by searches and sweeps
const filerIdCache = new Map<number, number>()

function populateFilerIdCache(filers: EthicsFiler[]) {
  for (const f of filers) {
    if (f.candidateFilerId && f.seiFilerId) {
      filerIdCache.set(f.candidateFilerId, f.seiFilerId)
    }
  }
}

export async function searchFilers(name: string): Promise<EthicsFiler[]> {
  const response = await fetch(`${BASE}/Ethics/Get/Public/Search/By/Filer/Name/`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(name.trim()),
  })
  if (!response.ok) return []
  const data = await response.json()
  const results = data.result || []
  populateFilerIdCache(results)
  return results
}

export async function getFilerProfile(
  candidateFilerId: number,
  seiFilerId: number
): Promise<FilerProfile> {
  const response = await fetch(`${BASE}/Candidate/Campaign/Get/Personal/Profile`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ candidateFilerId, seiFilerId }),
  })
  if (!response.ok) throw new Error(`Profile request failed: ${response.status}`)
  return response.json()
}

function parseDate(dateStr: string): number {
  if (!dateStr) return 0
  const [month, day, year] = dateStr.split('/')
  return new Date(+year, +month - 1, +day).getTime()
}

export function dedupeKey(filer: EthicsFiler): string {
  if (filer.universalUserId > 0) return `u-${filer.universalUserId}`
  const namePart = filer.candidate?.toLowerCase().trim() || ''
  // Prefer seiFilerId when available (more stable than address)
  if (filer.seiFilerId > 0) return `ns-${namePart}-${filer.seiFilerId}`
  // Last resort: name + address prefix
  const addrPart = filer.address?.toLowerCase().trim().slice(0, 20) || ''
  return `na-${namePart}-${addrPart}`
}

// Office name cache — populated as side effect of sweepAllFilers()
const officeNameCache = new Set<string>()

// Sweep result cache — populated by sweepAllFilers(), reused for 30 min
interface SweepCache {
  allResults: EthicsFiler[]
  failed: number
  timestamp: number
}
let sweepCache: SweepCache | null = null
const SWEEP_CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

/** @internal — exported for testing */
export function isTestAccount(filer: EthicsFiler): boolean {
  const name = filer.candidate?.toLowerCase() || ''
  if (name.includes('test, test')) return true
  if (name.includes('testing,')) return true
  // Filer records with 50+ offices are test scaffolding
  const officeCount = filer.officeName ? filer.officeName.split(',').length : 0
  if (officeCount >= 50) return true
  return false
}

async function sweepAllFilers(): Promise<{ allResults: EthicsFiler[]; failed: number }> {
  // Return cached sweep if fresh
  if (sweepCache && Date.now() - sweepCache.timestamp < SWEEP_CACHE_TTL_MS) {
    return { allResults: sweepCache.allResults, failed: sweepCache.failed }
  }

  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('')
  const BATCH_SIZE = 6
  const TIMEOUT_MS = 10_000
  const rawResults: EthicsFiler[] = []
  let failed = 0

  for (let i = 0; i < letters.length; i += BATCH_SIZE) {
    const batch = letters.slice(i, i + BATCH_SIZE)
    const settled = await Promise.allSettled(
      batch.map(async (letter) => {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
        try {
          const response = await fetch(`${BASE}/Ethics/Get/Public/Search/By/Filer/Name/`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(letter),
            signal: controller.signal,
          })
          if (!response.ok) return []
          const data = await response.json()
          return (data.result || []) as EthicsFiler[]
        } finally {
          clearTimeout(timeout)
        }
      })
    )
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        rawResults.push(...result.value)
      } else {
        failed++
      }
    }
  }

  // Filter test/junk accounts
  const allResults = rawResults.filter(filer => !isTestAccount(filer))

  // Re-populate office name cache from filtered results
  officeNameCache.clear()
  for (const filer of allResults) {
    if (filer.officeName) {
      for (const part of filer.officeName.split(',')) {
        const trimmed = part.trim()
        if (trimmed) officeNameCache.add(trimmed)
      }
    }
  }

  // Populate filerIdCache from sweep results
  populateFilerIdCache(allResults)

  // Store in cache
  sweepCache = { allResults, failed, timestamp: Date.now() }

  return { allResults, failed }
}

export async function searchFilersByOffice(
  officeName: string,
  activeSince?: number,
): Promise<OfficeFilerResult> {
  const { allResults, failed } = await sweepAllFilers()

  // Filter by office name (case-insensitive partial match)
  const needle = officeName.toLowerCase()
  const matching = allResults.filter(f =>
    f.officeName?.toLowerCase().includes(needle)
  )

  // Filter by active_since year
  const activeSinceFiltered = activeSince
    ? matching.filter(f => {
        if (!f.lastSubmission) return false
        const [, , year] = f.lastSubmission.split('/')
        return parseInt(year, 10) >= activeSince
      })
    : matching

  // Deduplicate: prefer record with most recent submission per person
  const seen = new Map<string, EthicsFiler>()
  for (const filer of activeSinceFiltered) {
    const key = dedupeKey(filer)
    const existing = seen.get(key)
    if (!existing || parseDate(filer.lastSubmission) > parseDate(existing.lastSubmission)) {
      seen.set(key, filer)
    }
  }

  // Sort by most recent submission descending
  const filers = [...seen.values()].sort((a, b) =>
    parseDate(b.lastSubmission) - parseDate(a.lastSubmission)
  )

  return { filers, totalSearched: 26, totalFailed: failed }
}

export function groupFilersByPerson(filers: EthicsFiler[]): GroupedFiler[] {
  const grouped = new Map<string, GroupedFiler>()
  for (const filer of filers) {
    const key = dedupeKey(filer)
    const existing = grouped.get(key)
    const officeEntry = {
      officeName: filer.officeName || '',
      officeId: filer.officeId,
      lastSubmission: filer.lastSubmission,
    }
    if (existing) {
      const alreadyHas = existing.offices.some(o => o.officeId === filer.officeId)
      if (!alreadyHas) existing.offices.push(officeEntry)
      if (parseDate(filer.lastSubmission) > parseDate(existing.lastSubmission)) {
        existing.lastSubmission = filer.lastSubmission
        existing.candidateFilerId = filer.candidateFilerId
        existing.seiFilerId = filer.seiFilerId
      }
    } else {
      grouped.set(key, {
        candidate: filer.candidate,
        address: filer.address,
        universalUserId: filer.universalUserId,
        candidateFilerId: filer.candidateFilerId,
        seiFilerId: filer.seiFilerId,
        lastSubmission: filer.lastSubmission,
        offices: [officeEntry],
      })
    }
  }
  return [...grouped.values()].sort((a, b) => parseDate(b.lastSubmission) - parseDate(a.lastSubmission))
}

export async function listOfficeNames(keyword?: string): Promise<string[]> {
  // sweepAllFilers() handles caching internally (30 min TTL)
  await sweepAllFilers()
  let names = [...officeNameCache].sort()
  if (keyword) {
    const needle = keyword.toLowerCase()
    names = names.filter(n => n.toLowerCase().includes(needle))
  }
  return names
}

// ============================================================
// Campaign Finance — Per-Candidate
// ============================================================

/** Try to resolve a candidate's display name when summary.name is null */
export async function resolveCandidateName(candidateFilerId: number): Promise<string | undefined> {
  const seiFilerId = filerIdCache.get(candidateFilerId)
  if (!seiFilerId) return undefined
  try {
    const profile = await getFilerProfile(candidateFilerId, seiFilerId)
    return profile.name || undefined
  } catch {
    return undefined
  }
}

export async function getCampaignSummary(candidateFilerId: number): Promise<CampaignSummary> {
  const response = await fetch(
    `${BASE}/Ethics/Get/Public/Candidate/Report/Summary/${candidateFilerId}`,
    { headers: HEADERS }
  )
  if (!response.ok) throw new Error(`Campaign summary request failed: ${response.status}`)
  return response.json()
}

export async function getCampaignReports(
  campaignId: number,
  candidateFilerId: number
): Promise<CampaignReport[]> {
  const response = await fetch(`${BASE}/Ethics/Get/Public/Candidate/Reports`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ campaignId, candidateFilerId }),
  })
  if (!response.ok) return []
  const data = await response.json()
  return data.results || data || []
}

export async function getCampaignReportDetails(reportId: number): Promise<CampaignReportDetails> {
  const response = await fetch(
    `${BASE}/Ethics/Get/Public/Candidate/Report/Details/${reportId}`,
    { headers: HEADERS }
  )
  if (!response.ok) throw new Error(`Report details request failed: ${response.status}`)
  return response.json()
}

export async function getContributions(
  campaignId: number,
  candidateFilerId: number
): Promise<CampaignContribution[]> {
  const response = await fetch(`${BASE}/Candidate/Contribution/Get/All/Campaign/Grid`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      campaignId: String(campaignId),
      candidateFilerId: String(candidateFilerId),
      isFiled: true,
    }),
  })
  if (!response.ok) return []
  return response.json()
}

export async function getExpenditures(
  campaignId: number,
  candidateFilerId: number
): Promise<CampaignExpenditure[]> {
  const response = await fetch(`${BASE}/Candidate/Expenditure/Get/All/Campaign/Grid`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      campaignId: String(campaignId),
      candidateFilerId: String(candidateFilerId),
      isFiled: true,
    }),
  })
  if (!response.ok) return []
  return response.json()
}

// ============================================================
// Campaign Finance — Helpers & Cache
// ============================================================

const campaignSummaryCache = new Map<number, { data: CampaignSummary; timestamp: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export async function cachedGetCampaignSummary(candidateFilerId: number): Promise<CampaignSummary> {
  const cached = campaignSummaryCache.get(candidateFilerId)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data
  }
  const data = await getCampaignSummary(candidateFilerId)
  campaignSummaryCache.set(candidateFilerId, { data, timestamp: Date.now() })
  return data
}

export function normalizeOfficeName(raw: string): NormalizedOffice {
  if (!raw) return { raw, normalized: raw }

  let district: string | undefined
  let body: string | undefined

  // Extract district number
  const distMatch = raw.match(/District\s+(\d+)/i) ||
    raw.match(/Dist\.?\s*(\d+)/i) ||
    raw.match(/Seat\s+(\d+)/i)
  if (distMatch) {
    district = distMatch[1]
  }

  // Extract body
  const bodyPatterns: [RegExp, string][] = [
    [/County\s+Council/i, 'County Council'],
    [/State\s+House/i, 'State House'],
    [/State\s+Senate/i, 'State Senate'],
    [/Governor/i, 'Governor'],
    [/Sheriff/i, 'Sheriff'],
    [/Solicitor/i, 'Solicitor'],
    [/Attorney\s+General/i, 'Attorney General'],
    [/Lt\.?\s*Governor/i, 'Lt Governor'],
    [/Secretary\s+of\s+State/i, 'Secretary of State'],
    [/Comptroller/i, 'Comptroller General'],
    [/Treasurer/i, 'State Treasurer'],
    [/Superintendent/i, 'Superintendent of Education'],
    [/School\s+Board/i, 'School Board'],
    [/City\s+Council/i, 'City Council'],
    [/Mayor/i, 'Mayor'],
    [/Probate\s+Judge/i, 'Probate Judge'],
    [/Auditor/i, 'Auditor'],
    [/Coroner/i, 'Coroner'],
    [/Clerk\s+of\s+Court/i, 'Clerk of Court'],
  ]

  for (const [pattern, name] of bodyPatterns) {
    if (pattern.test(raw)) {
      body = name
      break
    }
  }

  // Build normalized name
  let normalized = raw
    .replace(/^Other\s+Office,?\s*/i, '')
    .replace(/^District\s+\d+\s*,?\s*/i, '')
    .trim()

  if (body && district) {
    // Check if county name is present
    const countyMatch = raw.match(/(\w+)\s+County/i)
    if (countyMatch) {
      normalized = `${countyMatch[1]} ${body} District ${district}`
    } else {
      normalized = `${body} District ${district}`
    }
  } else if (!body) {
    normalized = raw
  }

  return { raw, normalized, district, body }
}

function extractDistrictNumber(text: string): string | undefined {
  const m = text.match(/District\s+(\d+)/i) ||
    text.match(/Dist\.?\s*(\d+)/i) ||
    text.match(/Seat\s+(\d+)/i)
  return m?.[1]
}

export function resolveCampaignContext(
  summary: CampaignSummary,
  candidateFilerId: number,
  campaignId?: number,
  officeHint?: string,
  candidateNameOverride?: string,
): { context: CampaignContext; resolvedCampaignId: number; resolvedFilerId: number } | { error: string } {
  const allOffices: (CampaignOfficeReport & { status: 'open' | 'closed' })[] = [
    ...summary.openReports.map(r => ({ ...r, status: 'open' as const })),
    ...summary.closedReports.map(r => ({ ...r, status: 'closed' as const })),
  ]

  const candidateName = candidateNameOverride || summary.name || 'Unknown'

  function makeContext(office: CampaignOfficeReport & { status: 'open' | 'closed' }): {
    context: CampaignContext
    resolvedCampaignId: number
    resolvedFilerId: number
  } {
    return {
      context: {
        candidateName,
        officeName: office.officeName,
        campaignId: office.officeId,
        candidateFilerId: office.filerId,
        campaignStatus: office.status,
      },
      resolvedCampaignId: office.officeId,
      resolvedFilerId: office.filerId,
    }
  }

  function officeListError(offices: typeof allOffices): string {
    const lines = offices.map(o =>
      `  - ${o.officeName} (campaignId: ${o.officeId}, ${o.status}, balance: $${o.balance.toFixed(2)})`
    )
    return `Multiple campaigns found for this candidate. Specify campaign_id or office hint:\n${lines.join('\n')}`
  }

  // 1. If campaignId provided, validate it exists
  if (campaignId !== undefined) {
    const match = allOffices.find(o => o.officeId === campaignId)
    if (!match) {
      const lines = allOffices.map(o =>
        `  - ${o.officeName} (campaignId: ${o.officeId}, ${o.status})`
      )
      return {
        error: `Campaign ID ${campaignId} not found for this candidate. Available campaigns:\n${lines.join('\n')}`,
      }
    }
    return makeContext(match)
  }

  // 2. If officeHint provided, try to narrow
  if (officeHint) {
    const hint = officeHint.toLowerCase()
    let matches = allOffices.filter(o => o.officeName.toLowerCase().includes(hint))

    if (matches.length === 1) return makeContext(matches[0])

    if (matches.length > 1) {
      // Try district extraction to disambiguate
      const hintDistrict = extractDistrictNumber(officeHint)
      if (hintDistrict) {
        const districtMatches = matches.filter(o =>
          extractDistrictNumber(o.officeName) === hintDistrict
        )
        if (districtMatches.length === 1) return makeContext(districtMatches[0])
      }
      // Prefer open over closed
      const openMatches = matches.filter(o => o.status === 'open')
      if (openMatches.length === 1) return makeContext(openMatches[0])
      if (openMatches.length > 1) return { error: officeListError(openMatches) }
      // All closed — fall through to no-hint logic with filtered set
      matches = matches.sort((a, b) =>
        new Date(b.initialReportFiledDate).getTime() - new Date(a.initialReportFiledDate).getTime()
      )
      return makeContext(matches[0])
    }
    // Zero matches — fall through to no-hint logic
  }

  // 3. No campaignId, no usable hint — auto-resolve
  const open = allOffices.filter(o => o.status === 'open')
  const closed = allOffices.filter(o => o.status === 'closed')

  if (open.length === 1) return makeContext(open[0])
  if (open.length === 0 && closed.length === 1) return makeContext(closed[0])
  if (open.length === 0 && closed.length > 1) {
    // Use most recent by initialReportFiledDate
    const sorted = [...closed].sort((a, b) =>
      new Date(b.initialReportFiledDate).getTime() - new Date(a.initialReportFiledDate).getTime()
    )
    return makeContext(sorted[0])
  }
  if (open.length > 1) return { error: officeListError(open) }

  // No offices at all
  return { error: 'No campaign offices found for this candidate.' }
}

const SELF_FUNDING_TYPES = ['personal contribution', 'candidate loan', 'personal loan']

export function buildContributionSummary(
  contributions: CampaignContribution[],
  context: CampaignContext,
): ContributionSummary {
  const byDonor = new Map<string, { totalAmount: number; count: number }>()
  const byType: Record<string, { count: number; amount: number }> = {}
  let totalAmount = 0
  let selfFundingTotal = 0
  const dates: string[] = []

  for (const c of contributions) {
    totalAmount += c.credit
    if (c.date) dates.push(c.date)

    // Aggregate by donor
    const donorKey = c.paidBy.trim().toLowerCase()
    const existing = byDonor.get(donorKey)
    if (existing) {
      existing.totalAmount += c.credit
      existing.count++
    } else {
      byDonor.set(donorKey, { totalAmount: c.credit, count: 1 })
    }

    // Aggregate by type
    const typeKey = c.type || 'Unknown'
    if (!byType[typeKey]) byType[typeKey] = { count: 0, amount: 0 }
    byType[typeKey].count++
    byType[typeKey].amount += c.credit

    // Self-funding detection
    if (SELF_FUNDING_TYPES.includes(c.type.toLowerCase())) {
      selfFundingTotal += c.credit
    }
  }

  // Sort donors by total, take top 20
  const topDonors = [...byDonor.entries()]
    .map(([name, data]) => ({
      name: contributions.find(c => c.paidBy.trim().toLowerCase() === name)?.paidBy.trim() || name,
      totalAmount: data.totalAmount,
      count: data.count,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 20)

  // Date range
  let dateRange: ContributionSummary['dateRange'] = null
  if (dates.length > 0) {
    const sorted = [...dates].sort((a, b) => parseDate(a) - parseDate(b))
    dateRange = { earliest: sorted[0], latest: sorted[sorted.length - 1] }
  }

  return {
    context,
    totalCount: contributions.length,
    totalAmount,
    dateRange,
    byType,
    selfFundingTotal,
    topDonors,
  }
}

export function buildExpenditureSummary(
  expenditures: CampaignExpenditure[],
  context: CampaignContext,
): ExpenditureSummary {
  const byVendor = new Map<string, { totalAmount: number; count: number }>()
  const byType: Record<string, { count: number; amount: number }> = {}
  let totalAmount = 0
  const dates: string[] = []

  for (const e of expenditures) {
    totalAmount += e.debit
    if (e.date) dates.push(e.date)

    // Aggregate by vendor
    const vendorKey = e.paidTo.trim().toLowerCase()
    const existing = byVendor.get(vendorKey)
    if (existing) {
      existing.totalAmount += e.debit
      existing.count++
    } else {
      byVendor.set(vendorKey, { totalAmount: e.debit, count: 1 })
    }

    // Aggregate by type
    const typeKey = e.type || 'Unknown'
    if (!byType[typeKey]) byType[typeKey] = { count: 0, amount: 0 }
    byType[typeKey].count++
    byType[typeKey].amount += e.debit
  }

  // Sort vendors by total, take top 20
  const topVendors = [...byVendor.entries()]
    .map(([name, data]) => ({
      name: expenditures.find(e => e.paidTo.trim().toLowerCase() === name)?.paidTo.trim() || name,
      totalAmount: data.totalAmount,
      count: data.count,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 20)

  // Date range
  let dateRange: ExpenditureSummary['dateRange'] = null
  if (dates.length > 0) {
    const sorted = [...dates].sort((a, b) => parseDate(a) - parseDate(b))
    dateRange = { earliest: sorted[0], latest: sorted[sorted.length - 1] }
  }

  return {
    context,
    totalCount: expenditures.length,
    totalAmount,
    dateRange,
    byType,
    topVendors,
  }
}

// ============================================================
// Campaign Finance — Cross-Candidate Search
// ============================================================

export async function searchExpenditures(filters: {
  candidate?: string
  office?: string
  vendorName?: string
  expenditureYear?: number
  vendorLoc?: string
  amount?: number
  expDesc?: string
}): Promise<CrossSearchExpenditure[]> {
  const response = await fetch(
    `${BASE}/Candidate/Expenditure/Public/Get/All/Campaign/Expenditures`,
    {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        candidate: filters.candidate || '',
        office: filters.office || '',
        vendorName: filters.vendorName || '',
        expenditureYear: filters.expenditureYear || 0,
        vendorLoc: filters.vendorLoc || 'Any',
        amount: filters.amount || 0,
        expDesc: filters.expDesc || '',
      }),
    }
  )
  if (!response.ok) return []
  return response.json()
}

export async function searchContributions(filters: {
  candidate?: string
  office?: string
  contributorName?: string
  contributionYear?: number
  contributorLoc?: string
  amount?: number
}): Promise<CrossSearchContribution[]> {
  const response = await fetch(`${BASE}/Candidate/Contribution/Search/`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      candidate: filters.candidate || '',
      office: filters.office || '',
      contributorName: filters.contributorName || '',
      contributionYear: filters.contributionYear || 0,
      contributorLoc: filters.contributorLoc || 'Any',
      amount: filters.amount || 0,
    }),
  })
  if (!response.ok) return []
  return response.json()
}

// ============================================================
// Statement of Economic Interest (SEI)
// ============================================================

export async function getSeiReportVersions(seiFilerId: number): Promise<SeiReport[]> {
  // Use the overview endpoint which returns { gridRows: [...] }
  const response = await fetch(
    `${BASE}/Sei/Report/Get/Filed/Overview/${seiFilerId}`,
    { headers: HEADERS }
  )
  if (!response.ok) return []
  const data = await response.json()
  const rows = data.gridRows || []
  return rows.map((row: any) => ({
    seiFilerId,
    seiReportId: row.reportId,
    year: parseInt(row.filingYear, 10),
    reportType: row.seiReport,
    dateSubmitted: row.submittedString || row.submitted,
    status: row.status,
  }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seiPost(path: string, body: SeiReportBody): Promise<any[]> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  if (!response.ok) return []
  const data = await response.json()
  return Array.isArray(data) ? data.filter((item: any) => !item.isDeleted) : []
}

export async function getSeiDetails(
  seiFilerId: number,
  reportYear?: number
): Promise<SeiDetails | null> {
  const reports = await getSeiReportVersions(seiFilerId)
  if (reports.length === 0) return null

  const sorted = reports.sort((a, b) => b.year - a.year)
  const report = reportYear
    ? sorted.find(r => r.year === reportYear)
    : sorted[0]

  if (!report) return null

  const body: SeiReportBody = {
    seiFilerId,
    seiReportId: report.seiReportId,
    getUnfiled: false,
  }

  const [
    positions,
    businessInterests,
    privateIncome,
    governmentIncome,
    familyPrivateIncome,
    familyGovernmentIncome,
    gifts,
    travel,
    governmentContracts,
    creditors,
    lobbyistFamily,
    lobbyistPurchases,
    regulatedBusinessAssociations,
    propertyTransactions,
    propertyImprovements,
    propertyConflicts,
    additionalInformation,
  ] = await Promise.all([
    seiPost('/Sei/Filer/Position/Get/All/Report/Positions', body),
    seiPost('/Sei/Business/Interests/Get/Many/For/Report', body),
    seiPost('/Sei/Income/And/Benefits/Get/Private/IncomeAndBenefits/For/Report', body),
    seiPost('/Sei/Income/And/Benefits/Get/Government/IncomeAndBenefits/For/Report', body),
    seiPost('/Sei/Family/Income/And/Benefits/Get/All/Private/Income/For/Report/', body),
    seiPost('/Sei/Family/Income/And/Benefits/Get/All/Government/Income/For/Report/', body),
    seiPost('/Sei/Report/Get/Gifts', body),
    seiPost('/Sei/Travel/Get/All/Travel/Records', body),
    seiPost('/Sei/Report/Get/Gov/Contracts/Records', body),
    seiPost('/Sei/Creditors/Get/Report/SeiCreditors', body),
    seiPost('/Sei/Lobbyist/Get/Many/LobbyistFamily', body),
    seiPost('/Sei/Lobbyist/Get/Many/LobbyistPurchase', body),
    seiPost('/Sei/Regulated/Business/Assoc/Get/Many/For/Report', body),
    seiPost('/Sei/Property/Sold/Leased/Rented/Get/Report/Property/Transactions', body),
    seiPost('/Sei/Property/Sold/Leased/Rented/Get/Report/Property/Improvements', body),
    seiPost('/Sei/Property/Sold/Leased/Rented/Get/Report/Property/Conflicts', body),
    seiPost('/Sei/Additional/Information/Get/Many/AdditionalInfo', body),
  ])

  return {
    seiFilerId,
    seiReportId: report.seiReportId,
    reportYear: report.year,
    dateSubmitted: report.dateSubmitted,
    positions,
    businessInterests,
    privateIncome,
    governmentIncome,
    familyPrivateIncome,
    familyGovernmentIncome,
    gifts,
    travel,
    governmentContracts,
    creditors,
    lobbyistFamily,
    lobbyistPurchases,
    regulatedBusinessAssociations,
    propertyTransactions,
    propertyImprovements,
    propertyConflicts,
    additionalInformation,
  }
}
