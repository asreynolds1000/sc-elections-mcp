import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { searchExpenditures, searchContributions, searchCampaignReports, normalizeOfficeName } from '../api/ethics-client.js'
import type { CrossSearchContribution, CrossSearchExpenditure, CrossSearchReport } from '../types.js'

const CHAR_BUDGET = 60_000

/** @internal — exported for testing */
export function summarizeCrossSearchContributions(results: CrossSearchContribution[]) {
  const byCandidate = new Map<string, { candidateName: string; officeName: string; totalAmount: number; count: number }>()
  let grandTotal = 0
  for (const r of results) {
    grandTotal += r.amount
    const key = `${r.candidateId}-${r.officeRunId}`
    const existing = byCandidate.get(key)
    if (existing) {
      existing.totalAmount += r.amount
      existing.count++
    } else {
      byCandidate.set(key, {
        candidateName: r.candidateName,
        officeName: r.officeName,
        totalAmount: r.amount,
        count: 1,
      })
    }
  }
  return {
    totalRecords: results.length,
    grandTotal,
    byCandidateTop20: [...byCandidate.values()]
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 20),
  }
}

/** @internal — exported for testing */
export function summarizeCrossSearchExpenditures(results: CrossSearchExpenditure[]) {
  const byVendor = new Map<string, { vendorName: string; totalAmount: number; count: number; candidates: Set<string> }>()
  let grandTotal = 0
  for (const r of results) {
    grandTotal += r.amount
    const key = r.vendorName.trim().toLowerCase()
    const existing = byVendor.get(key)
    if (existing) {
      existing.totalAmount += r.amount
      existing.count++
      existing.candidates.add(r.candidateName)
    } else {
      byVendor.set(key, {
        vendorName: r.vendorName,
        totalAmount: r.amount,
        count: 1,
        candidates: new Set([r.candidateName]),
      })
    }
  }
  return {
    totalRecords: results.length,
    grandTotal,
    byVendorTop20: [...byVendor.values()]
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 20)
      .map(v => ({ vendorName: v.vendorName, totalAmount: v.totalAmount, count: v.count, candidateCount: v.candidates.size, candidates: [...v.candidates].slice(0, 5) })),
  }
}

function applyCharBudget<T>(output: T[]): { finalText: string; budgetWarning: string } {
  const rawText = JSON.stringify(output, null, 2)
  if (rawText.length <= CHAR_BUDGET) {
    return { finalText: rawText, budgetWarning: '' }
  }
  // Linear scan: find how many records fit in the budget
  let kept = 0
  let runningLength = 2 // opening "[\n"
  for (let i = 0; i < output.length; i++) {
    const itemStr = JSON.stringify(output[i], null, 2)
    const addedLength = itemStr.length + (i > 0 ? 2 : 0) // comma + newline
    if (runningLength + addedLength + 2 > CHAR_BUDGET) break // +2 for closing "\n]"
    runningLength += addedLength
    kept++
  }
  if (kept === 0) kept = 1 // Always include at least one record
  const budgetWarning = `\nWARNING: Response truncated to ${kept} of ${output.length} records (60K char budget). Use slim=true to strip address fields, summary=true for aggregated view, or add more filters.`
  return { finalText: JSON.stringify(output.slice(0, kept), null, 2), budgetWarning }
}

export function registerCrossSearchTools(server: McpServer) {
  server.tool(
    'search_expenditures',
    'Search expenditures across ALL candidates statewide. At least one filter required. Default limit 200 (0 for all). Use slim=true to strip address fields, summary=true for aggregated view. Responses auto-truncate at 60K chars. IMPORTANT: Office names in results are inconsistent — use broad office filters or omit office and filter by candidate name instead.',
    {
      candidate: z.string().optional().describe('Candidate name filter (partial match)'),
      office: z.string().optional().describe('Office name filter (partial match)'),
      vendor_name: z.string().optional().describe('Vendor/payee name filter (partial match)'),
      year: z.number().optional().describe('Election year filter (e.g. 2024). Omit for all years.'),
      amount: z.number().optional().describe('Minimum amount filter'),
      description: z.string().optional().describe('Expenditure description filter'),
      limit: z.number().optional().describe('Max results to return (default 200, 0 for all).'),
      slim: z.boolean().optional().describe('If true, strip address fields to reduce response size.'),
      summary: z.boolean().optional().describe('If true, group by vendor and return totals instead of individual records.'),
    },
    async ({ candidate, office, vendor_name, year, amount, description, limit, slim, summary }) => {
      try {
        // Guard: all-empty queries return the entire expenditure database
        const hasAnyFilter = candidate || office || vendor_name || year || amount || description
        if (!hasAnyFilter) {
          return {
            content: [{
              type: 'text' as const,
              text: 'At least one filter is required for search_expenditures. Provide candidate, office, vendor_name, year, amount, or description.',
            }],
            isError: true,
          }
        }

        const results = await searchExpenditures({
          candidate,
          office,
          vendorName: vendor_name,
          expenditureYear: year,
          amount,
          expDesc: description,
        })
        const enriched = results.map(r => ({
          ...r,
          normalizedOffice: normalizeOfficeName(r.office),
        }))

        if (summary) {
          const summaryData = summarizeCrossSearchExpenditures(results)
          return { content: [{ type: 'text' as const, text: JSON.stringify(summaryData, null, 2) }] }
        }

        const effectiveLimit = limit === undefined ? 200 : limit
        const totalCount = enriched.length
        const limited = effectiveLimit > 0 ? enriched.slice(0, effectiveLimit) : enriched

        // Apply slim mode
        const output = slim
          ? limited.map(({ address, ...rest }) => rest)
          : limited

        const limitNote = effectiveLimit > 0 && totalCount > effectiveLimit
          ? `\nShowing ${effectiveLimit} of ${totalCount}. Use limit=0 for all.`
          : ''

        // Apply char budget
        const { finalText, budgetWarning } = applyCharBudget(output)

        return {
          content: [{
            type: 'text' as const,
            text: enriched.length === 0
              ? 'No expenditures found matching filters'
              : `${totalCount} expenditure(s) found:${limitNote}${budgetWarning}\n${finalText}`,
          }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'search_contributions',
    'Search contributions across ALL candidates statewide. At least one filter besides office required (office filter is broken server-side). Default limit 200 (0 for all). Use slim=true to strip address/occupation fields, summary=true for aggregated view. Responses auto-truncate at 60K chars.',
    {
      candidate: z.string().optional().describe('Candidate name filter (partial match)'),
      office: z.string().optional().describe('Office name filter (partial match)'),
      contributor_name: z.string().optional().describe('Contributor/donor name filter (partial match)'),
      year: z.number().optional().describe('Election year filter (e.g. 2024). Omit for all years.'),
      amount: z.number().optional().describe('Minimum amount filter'),
      limit: z.number().optional().describe('Max results to return (default 200, 0 for all).'),
      slim: z.boolean().optional().describe('If true, strip address/occupation/group fields to reduce response size.'),
      summary: z.boolean().optional().describe('If true, group by candidate and return totals instead of individual records.'),
    },
    async ({ candidate, office, contributor_name, year, amount, limit, slim, summary }) => {
      try {
        // Guard: all-empty or office-only queries return ~79K unfiltered results (server ignores office filter)
        const hasOtherFilter = candidate || contributor_name || year || amount
        if (!hasOtherFilter) {
          return {
            content: [{
              type: 'text' as const,
              text: office
                ? 'The office filter on search_contributions is broken server-side — the API ignores it and returns ~79K unfiltered results. Use list_filers_by_office to find candidates for that office, then get_contributions for each candidate individually.'
                : 'At least one filter is required for search_contributions. Provide candidate, contributor_name, year, or amount.',
            }],
            isError: true,
          }
        }

        const results = await searchContributions({
          candidate,
          office,
          contributorName: contributor_name,
          contributionYear: year,
          amount,
        })
        const enriched = results.map(r => ({
          ...r,
          normalizedOffice: normalizeOfficeName(r.officeName),
        }))

        if (summary) {
          const summaryData = summarizeCrossSearchContributions(results)
          return { content: [{ type: 'text' as const, text: JSON.stringify(summaryData, null, 2) }] }
        }

        const effectiveLimit = limit === undefined ? 200 : limit
        const totalCount = enriched.length
        const limited = effectiveLimit > 0 ? enriched.slice(0, effectiveLimit) : enriched

        // Apply slim mode
        const output = slim
          ? limited.map(({ contributorAddress, contributorOccupation, group, ...rest }) => rest)
          : limited

        const limitNote = effectiveLimit > 0 && totalCount > effectiveLimit
          ? `\nShowing ${effectiveLimit} of ${totalCount}. Use limit=0 for all.`
          : ''

        // Apply char budget
        const { finalText, budgetWarning } = applyCharBudget(output)

        return {
          content: [{
            type: 'text' as const,
            text: enriched.length === 0
              ? 'No contributions found matching filters'
              : `${totalCount} contribution(s) found:${limitNote}${budgetWarning}\n${finalText}`,
          }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'search_campaign_reports',
    'Search campaign disclosure reports across ALL candidates statewide. Find who has filed Initial reports, Quarterly reports, etc. for a given election year. Great for discovering new candidates entering races. "Who has filed?" → use report_type="Initial" + election_year=current year + since="today". Default limit 200 (0 for all). Responses auto-truncate at 60K chars.',
    {
      candidate: z.string().optional().describe('Candidate name filter (partial match, "Last, First" format)'),
      office: z.string().optional().describe('Office name filter (partial match, e.g. "Greenville County Council", "House")'),
      report_type: z.enum(['Any', 'Initial', 'Quarterly', 'Pre-Election', 'Final']).optional()
        .describe('Report type. "Initial" = new campaign openings. "Quarterly" = all quarterly filings. "Pre-Election" = pre-election reports. "Final" = campaign closings. "Any" or omit for all types.'),
      election_year: z.number().int().min(2000).describe('Election year (e.g. 2026). Required — API returns nothing without it.'),
      election_type: z.enum(['Any', 'Primary', 'General', 'Special', 'Municipal']).optional()
        .describe('Election type filter. Default "Any".'),
      limit: z.number().int().min(0).optional().describe('Max results to return (default 200, 0 for all).'),
      since: z.string().optional().describe('Date filter. Accepts YYYY-MM-DD or "today" or "yesterday". Only returns reports updated on/after this date. Use "today" for daily pulls.'),
      slim: z.boolean().optional().describe('If true, return only candidateName, office, reportName, electionType, and lastUpdated. Strips all IDs. Default false.'),
    },
    async ({ candidate, office, report_type, election_year, election_type, limit, since, slim }) => {
      try {
        const hasAnyFilter = candidate || office || (report_type && report_type !== 'Any') || election_year || (election_type && election_type !== 'Any')
        if (!hasAnyFilter) {
          return {
            content: [{
              type: 'text' as const,
              text: 'At least one filter is required. Common usage: report_type="Initial" + election_year=2026 to find new campaign filings.',
            }],
            isError: true,
          }
        }

        let results = await searchCampaignReports({
          candidate,
          office,
          reportType: report_type || 'Any',
          electionYear: election_year,
          electionType: election_type,
        })

        // Resolve since shortcuts and apply client-side date filter
        if (since) {
          let resolvedSince = since
          if (since.toLowerCase() === 'today') {
            resolvedSince = new Date().toISOString().slice(0, 10)
          } else if (since.toLowerCase() === 'yesterday') {
            const d = new Date()
            d.setDate(d.getDate() - 1)
            resolvedSince = d.toISOString().slice(0, 10)
          }
          // Append T00:00:00 to date-only strings so both sides parse as local time
          const sinceInput = resolvedSince.includes('T') ? resolvedSince : `${resolvedSince}T00:00:00`
          const sinceDate = new Date(sinceInput)
          if (isNaN(sinceDate.getTime())) {
            return {
              content: [{
                type: 'text' as const,
                text: `Invalid "since" date: "${since}". Use YYYY-MM-DD, "today", or "yesterday".`,
              }],
              isError: true,
            }
          }
          // Validate calendar date (catch Feb 30 → March 2 overflow)
          if (!resolvedSince.includes('T')) {
            const [y, m, d] = resolvedSince.split('-').map(Number)
            if (sinceDate.getFullYear() !== y || sinceDate.getMonth() + 1 !== m || sinceDate.getDate() !== d) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `Invalid calendar date: "${since}" does not exist. Use a real date in YYYY-MM-DD format.`,
                }],
                isError: true,
              }
            }
          }
          results = results.filter(r => new Date(r.lastUpdated) >= sinceDate)
        }

        // Normalize office names and sort by lastUpdated descending (newest first)
        const enriched = results
          .map(r => ({
            ...r,
            candidateName: r.candidateName.trim(),
            office: r.office.trim(),
            normalizedOffice: normalizeOfficeName(r.office.trim()),
          }))
          .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())

        const effectiveLimit = limit === undefined ? 200 : limit
        const totalCount = enriched.length
        const limited = effectiveLimit > 0 ? enriched.slice(0, effectiveLimit) : enriched

        // Apply slim mode — strip IDs, keep only human-readable fields
        const output = slim
          ? limited.map(r => ({
              candidateName: r.candidateName,
              office: r.office,
              reportName: r.reportName,
              electionType: r.electionType,
              lastUpdated: r.lastUpdated,
            }))
          : limited

        const limitNote = effectiveLimit > 0 && totalCount > effectiveLimit
          ? `\nShowing ${effectiveLimit} of ${totalCount}. Use limit=0 for all.`
          : ''

        const { finalText, budgetWarning } = applyCharBudget(output)

        return {
          content: [{
            type: 'text' as const,
            text: enriched.length === 0
              ? 'No campaign reports found matching filters'
              : `${totalCount} campaign report(s) found:${limitNote}${budgetWarning}\n${finalText}`,
          }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )
}
