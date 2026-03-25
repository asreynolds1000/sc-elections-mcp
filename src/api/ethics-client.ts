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
  CrossSearchReport,
  SeiReport,
  SeiReportBody,
  SeiDetails,
  OfficeFilerResult,
} from '../types.js'
import { extractCountyFromAddress, extractCountyFromOfficeName } from '../data/sc-counties.js'

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

/**
 * Resolve a candidate by first + last name, with optional county/city hint for disambiguation.
 * Returns the candidateFilerId for the best match, or an error message.
 */
export async function resolveByName(
  firstName: string,
  lastName: string,
  county?: string,
): Promise<{ candidateFilerId: number; candidateName: string } | { error: string }> {
  const results = await searchFilers(lastName)

  // Only exact last-name matches with a valid candidateFilerId
  const candidates = results.filter(r =>
    r.percentageAccuracy === 1 && r.candidateFilerId > 0
  )

  // Match first name against "Last, First ..." format
  const firstLower = firstName.toLowerCase()
  const nameMatches = candidates.filter(r => {
    const parts = r.candidate.split(',')
    if (parts.length < 2) return false
    const first = parts[1].trim().split(/\s+/)[0].toLowerCase()
    return first === firstLower || first.startsWith(firstLower) || firstLower.startsWith(first)
  })

  if (nameMatches.length === 0) {
    return { error: `No filer found matching "${firstName} ${lastName}". Try searching by last name only with search_filers.` }
  }

  // Deduplicate by universalUserId (consolidated accounts)
  const seen = new Set<number>()
  const unique = nameMatches.filter(r => {
    const key = r.universalUserId > 0 ? r.universalUserId : r.candidateFilerId
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (unique.length === 1) {
    return { candidateFilerId: unique[0].candidateFilerId, candidateName: unique[0].candidate }
  }

  // Multiple matches — try county/city disambiguation
  if (county) {
    const countyLower = county.toLowerCase()
    const countyMatches = unique.filter(r =>
      r.address.toLowerCase().includes(countyLower) ||
      r.officeName.toLowerCase().includes(countyLower)
    )
    if (countyMatches.length === 1) {
      return { candidateFilerId: countyMatches[0].candidateFilerId, candidateName: countyMatches[0].candidate }
    }
    if (countyMatches.length > 1) {
      return pickMostRecent(countyMatches)
    }
  }

  // No county or county didn't help — pick most recently active
  return pickMostRecent(unique)
}

function pickMostRecent(filers: EthicsFiler[]): { candidateFilerId: number; candidateName: string } {
  const sorted = [...filers].sort((a, b) => parseDate(b.lastSubmission) - parseDate(a.lastSubmission))
  return { candidateFilerId: sorted[0].candidateFilerId, candidateName: sorted[0].candidate }
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
  if (!response.ok) {
    if (response.status === 500 || response.status === 404) {
      throw new Error(`No filer found with candidate_filer_id=${candidateFilerId} / sei_filer_id=${seiFilerId}`)
    }
    throw new Error(`Profile request failed: ${response.status}`)
  }
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

/**
 * Token-based office name matching. All query tokens must appear as exact words
 * in at least one comma-separated segment of the text. "Other Office" segments
 * are ignored. Order-independent: "House District 13" matches "District 13 House".
 */
export function tokenMatch(query: string, text: string): boolean {
  if (!query || !text) return false

  const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (queryTokens.length === 0) return false

  // Split on commas into segments, filter out standalone "Other Office"
  const segments = text.split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s && s !== 'other office')

  for (const segment of segments) {
    const segmentWords = segment.split(/\s+/).filter(Boolean)
    if (queryTokens.every(token => segmentWords.includes(token))) {
      return true
    }
  }
  return false
}

/**
 * Shared helper: filter by activeSince year, deduplicate, and sort by most recent.
 */
function filterAndDedupFilers(matching: EthicsFiler[], activeSince?: number): EthicsFiler[] {
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
  return [...seen.values()].sort((a, b) =>
    parseDate(b.lastSubmission) - parseDate(a.lastSubmission)
  )
}

export async function searchFilersByOffice(
  officeName: string,
  activeSince?: number,
): Promise<OfficeFilerResult> {
  const { allResults, failed } = await sweepAllFilers()

  const matching = allResults.filter(f =>
    tokenMatch(officeName, f.officeName || '')
  )

  const filers = filterAndDedupFilers(matching, activeSince)
  return { filers, totalSearched: 26, totalFailed: failed }
}

export async function searchFilersByCounty(
  countyName: string,
  activeSince?: number,
): Promise<OfficeFilerResult> {
  const { allResults, failed } = await sweepAllFilers()

  const countyLower = countyName.toLowerCase()
  const matching = allResults.filter(f => {
    // Match 1: county name in office name (word-boundary)
    const officeCounty = extractCountyFromOfficeName(f.officeName || '')
    if (officeCounty?.toLowerCase() === countyLower) return true

    // Match 2: city in address maps to this county
    const addressCounty = extractCountyFromAddress(f.address || '')
    if (addressCounty?.toLowerCase() === countyLower) return true

    return false
  })

  const filers = filterAndDedupFilers(matching, activeSince)
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
  if (!response.ok) {
    if (response.status === 500 || response.status === 404) {
      throw new Error(`No candidate found with filer ID ${candidateFilerId}`)
    }
    throw new Error(`Campaign summary request failed: ${response.status}`)
  }
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
  if (!response.ok) {
    if (response.status === 500 || response.status === 404) {
      throw new Error(`No report found with ID ${reportId}`)
    }
    throw new Error(`Report details request failed: ${response.status}`)
  }
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

// Used by normalizeOfficeName (and enrichGroupedFilersWithCampaignData via normalizeOfficeName)
const STATE_BODIES = new Set(['Governor', 'Lt Governor', 'Attorney General', 'Secretary of State',
  'Comptroller General', 'State Treasurer', 'Superintendent of Education', 'State House',
  'State Senate', 'Solicitor'])
const COUNTY_BODIES = new Set(['County Council', 'Sheriff', 'Probate Judge', 'Auditor',
  'Coroner', 'Clerk of Court', 'School Board'])
const CITY_BODIES = new Set(['City Council', 'Mayor'])

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

  // Compute jurisdiction tier from body
  let jurisdictionTier: 'city' | 'county' | 'state' | undefined
  if (body) {
    if (STATE_BODIES.has(body)) jurisdictionTier = 'state'
    else if (COUNTY_BODIES.has(body)) jurisdictionTier = 'county'
    else if (CITY_BODIES.has(body)) jurisdictionTier = 'city'
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

  return { raw, normalized, district, body, jurisdictionTier }
}

function extractDistrictNumber(text: string): string | undefined {
  const m = text.match(/District\s+(\d+)/i) ||
    text.match(/Dist\.?\s*(\d+)/i) ||
    text.match(/Seat\s+(\d+)/i)
  return m?.[1]
}

/**
 * Enrich an array of GroupedFiler objects with campaign data (balance, status, campaignId).
 * Mutates in-place — callers must pass the same reference they later read from.
 * Batches 6 at a time, capped at 50 total enrichments.
 * @param officeMatcher — if provided, tokenMatch-filters campaign offices before picking best match (list_filers_by_office behavior). When omitted, picks any open campaign or the first one.
 * @returns true if enrichment was capped (grouped.length > 50)
 * @internal — exported for testing
 */
export async function enrichGroupedFilersWithCampaignData(
  grouped: GroupedFiler[],
  officeMatcher?: string,
): Promise<boolean> {
  const ENRICH_CAP = 50
  const BATCH_SIZE = 6
  const toEnrich = grouped.slice(0, ENRICH_CAP)

  for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
    const batch = toEnrich.slice(i, i + BATCH_SIZE)
    await Promise.allSettled(
      batch.map(async (gf) => {
        const summary = await cachedGetCampaignSummary(gf.candidateFilerId)
        const allOffices = [
          ...summary.openReports.map(r => ({ ...r, status: 'open' as const })),
          ...summary.closedReports.map(r => ({ ...r, status: 'closed' as const })),
        ]
        gf.normalizedOffice = normalizeOfficeName(gf.offices[0]?.officeName || '')
        let match: (typeof allOffices)[number] | undefined
        if (officeMatcher) {
          const matches = allOffices.filter(o => tokenMatch(officeMatcher, o.officeName))
          match = matches.find(o => o.status === 'open') || matches[0]
        } else {
          match = allOffices.find(o => o.status === 'open') || allOffices[0]
        }
        if (match) {
          gf.primaryOfficeName = match.officeName
          gf.campaignStatus = match.status
          gf.balance = match.balance
          gf.campaignId = match.officeId
        }
      })
    )
  }

  return grouped.length > ENRICH_CAP
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
// Cross-Candidate Report Search
// ============================================================

export async function searchCampaignReports(filters: {
  candidate?: string
  office?: string
  reportType?: string
  electionYear?: number
  electionType?: string
}): Promise<CrossSearchReport[]> {
  const response = await fetch(
    `${BASE}/Candidate/Report/Public/Campaign/Get/Reports`,
    {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        candidate: filters.candidate || '',
        office: filters.office || '',
        reportType: filters.reportType || 'Any',
        electionyear: filters.electionYear || 0,
        electionType: filters.electionType || 'Any',
      }),
    }
  )
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
