import { parse } from 'node-html-parser'
import type { VremsSearchCandidate } from '../types.js'

/**
 * Parse the HTML table fragment returned by VREMS CandidateSearch POST.
 * Extracts candidate data and IDs from the DataTable rows.
 */
export function parseSearchHtml(html: string): VremsSearchCandidate[] {
  const root = parse(html)
  const rows = root.querySelectorAll('table#gridCandidateSearch tbody tr')

  if (rows.length === 0) {
    // Try without table ID in case markup changes
    const altRows = root.querySelectorAll('tbody tr')
    if (altRows.length > 0) {
      return altRows.map(parseRow).filter(Boolean) as VremsSearchCandidate[]
    }
    return []
  }

  return rows.map(parseRow).filter(Boolean) as VremsSearchCandidate[]
}

function parseRow(row: ReturnType<typeof parse>): VremsSearchCandidate | null {
  const cells = row.querySelectorAll('td')
  if (cells.length < 7) return null

  const link = cells[2]?.querySelector('a')
  const href = link?.getAttribute('href') || ''

  // href = "CandidateDetail/?candidateId=12345&electionId=22121&searchType=Default"
  const params = new URLSearchParams(href.split('?')[1] || '')

  const rawRunningMate = cells[3]?.text?.trim() || ''
  return {
    candidateId: params.get('candidateId') || row.getAttribute('data-key') || '',
    electionId: params.get('electionId') || '',
    office: cells[0]?.text?.trim() || '',
    counties: cells[1]?.text?.trim() || '',
    name: cells[2]?.text?.trim() || '',
    runningMate: rawRunningMate === 'Not Designated' ? '' : rawRunningMate,
    party: cells[4]?.text?.trim() || '',
    filingLocation: cells[5]?.text?.trim() || '',
    status: cells[6]?.text?.trim() || '',
  }
}
