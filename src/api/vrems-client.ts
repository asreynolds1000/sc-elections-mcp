import type {
  VremsElectionYear,
  VremsElection,
  VremsCandidate,
  VremsSearchCandidate,
  CandidateSearchParams,
} from '../types.js'
import { parseCsvExport } from '../parsers/csv-export.js'
import { parseSearchHtml } from '../parsers/candidate-search.js'

const BASE = 'https://vrems.scvotes.sc.gov'

// ============================================================
// Election Lookup (clean JSON APIs)
// ============================================================

export async function getElectionYears(electionType: string): Promise<VremsElectionYear[]> {
  const response = await fetch(
    `${BASE}/Candidate/GetYearsByElectionType?electionType=${encodeURIComponent(electionType)}`,
    { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
  )
  if (!response.ok) return []
  return response.json()
}

export async function getElections(electionType: string, year: number): Promise<VremsElection[]> {
  const response = await fetch(
    `${BASE}/Candidate/GetElections?electionType=${encodeURIComponent(electionType)}&year=${year}`,
    { headers: { 'X-Requested-With': 'XMLHttpRequest' } }
  )
  if (!response.ok) return []
  return response.json()
}

// ============================================================
// Candidate Search (HTML + CSV export with session cookies)
// ============================================================

/**
 * Search candidates within an election. Uses a two-step flow:
 * 1. POST search to get HTML results + session cookie
 * 2. GET CSV export with session cookie for rich data (phone, email, filing fee)
 * Falls back to HTML parsing if CSV export fails.
 */
export async function searchCandidates(
  params: CandidateSearchParams
): Promise<{ candidates: VremsCandidate[]; fallback?: VremsSearchCandidate[] }> {
  const formBody = new URLSearchParams({
    ElectionId: params.electionId,
    SelectedOffice: params.office || '-1',
    SelectedAssociatedCounties: params.county || '',
    SelectedCandidateStatus: params.status || 'All',
    CandidateFirstName: params.firstName || '',
    CandidateLastName: params.lastName || '',
    SelectedPoliticalParty: params.party || 'All',
    SelectedFilingLocation: params.filingLocation || 'All',
  })

  // Step 1: POST search to establish session
  const searchResponse = await fetch(`${BASE}/Candidate/CandidateSearch/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: formBody.toString(),
  })

  if (!searchResponse.ok) {
    throw new Error(`Candidate search failed: ${searchResponse.status}`)
  }

  const searchHtml = await searchResponse.text()

  // Extract session cookie from Set-Cookie header
  const cookies = searchResponse.headers.getSetCookie?.() || []
  const sessionCookie = cookies.find(c =>
    c.startsWith('.AspNetCore.Mvc.CookieTempDataProvider')
  )

  if (sessionCookie) {
    // Step 2: GET CSV export with session cookie
    try {
      const exportResponse = await fetch(`${BASE}/Candidate/ExportSearchResults`, {
        headers: {
          Cookie: sessionCookie.split(';')[0],
        },
      })

      if (exportResponse.ok) {
        const csvText = await exportResponse.text()
        const candidates = parseCsvExport(csvText)
        if (candidates.length > 0) {
          return { candidates }
        }
      }
    } catch {
      // Fall through to HTML parsing
    }
  }

  // Fallback: parse HTML table
  const fallback = parseSearchHtml(searchHtml)
  return { candidates: [], fallback }
}

// ============================================================
// Candidate Detail (HTML page)
// ============================================================

/**
 * Fetch raw HTML for a candidate detail page.
 * Returns the HTML string for parsing by candidate-detail parser.
 */
export async function getCandidateDetailHtml(
  candidateId: string,
  electionId: string
): Promise<string> {
  const response = await fetch(
    `${BASE}/Candidate/CandidateDetail/?candidateId=${encodeURIComponent(candidateId)}&electionId=${encodeURIComponent(electionId)}&searchType=Default`
  )
  if (!response.ok) {
    throw new Error(`Candidate detail request failed: ${response.status}`)
  }
  return response.text()
}
