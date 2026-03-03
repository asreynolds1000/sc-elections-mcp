import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { searchExpenditures, searchContributions, normalizeOfficeName } from '../api/ethics-client.js'

export function registerCrossSearchTools(server: McpServer) {
  server.tool(
    'search_expenditures',
    'Search expenditures across ALL candidates statewide. Find who is paying a vendor, what a candidate is spending on, or expenditures by office/year. At least one filter required. Default limit 200 results (0 for all). IMPORTANT: Office names in results are inconsistent — use broad office filters (e.g. "greenville" not "greenville county council") or omit office and filter by candidate name instead.',
    {
      candidate: z.string().optional().describe('Candidate name filter (partial match)'),
      office: z.string().optional().describe('Office name filter (partial match)'),
      vendor_name: z.string().optional().describe('Vendor/payee name filter (partial match)'),
      year: z.number().optional().describe('Election year filter (e.g. 2024). Omit for all years.'),
      amount: z.number().optional().describe('Minimum amount filter'),
      description: z.string().optional().describe('Expenditure description filter'),
      limit: z.number().optional().describe('Max results to return (default 200, 0 for all). Broad searches can return thousands.'),
    },
    async ({ candidate, office, vendor_name, year, amount, description, limit }) => {
      try {
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
        const effectiveLimit = limit === undefined ? 200 : limit
        const totalCount = enriched.length
        const limited = effectiveLimit > 0 ? enriched.slice(0, effectiveLimit) : enriched
        const limitNote = effectiveLimit > 0 && totalCount > effectiveLimit
          ? `\nShowing ${effectiveLimit} of ${totalCount}. Use limit=0 for all.`
          : ''
        return {
          content: [{
            type: 'text' as const,
            text: enriched.length === 0
              ? 'No expenditures found matching filters'
              : `${totalCount} expenditure(s) found:${limitNote}\n${JSON.stringify(limited, null, 2)}`,
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
    'Search contributions across ALL candidates statewide. Find who is donating to whom, contributions by year, or donors by name. At least one filter besides office required. Default limit 200 results (0 for all). WARNING: The office filter is broken server-side — always combine office with another filter, or use list_filers_by_office + get_contributions per candidate instead.',
    {
      candidate: z.string().optional().describe('Candidate name filter (partial match)'),
      office: z.string().optional().describe('Office name filter (partial match)'),
      contributor_name: z.string().optional().describe('Contributor/donor name filter (partial match)'),
      year: z.number().optional().describe('Election year filter (e.g. 2024). Omit for all years.'),
      amount: z.number().optional().describe('Minimum amount filter'),
      limit: z.number().optional().describe('Max results to return (default 200, 0 for all). Broad searches can return thousands.'),
    },
    async ({ candidate, office, contributor_name, year, amount, limit }) => {
      try {
        // Guard: office-only queries return ~79K unfiltered results (server ignores the filter)
        const hasOtherFilter = candidate || contributor_name || year || amount
        if (office && !hasOtherFilter) {
          return {
            content: [{
              type: 'text' as const,
              text: 'The office filter on search_contributions is broken server-side — the API ignores it and returns ~79K unfiltered results. Use list_filers_by_office to find candidates for that office, then get_contributions for each candidate individually.',
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
        const effectiveLimit = limit === undefined ? 200 : limit
        const totalCount = enriched.length
        const limited = effectiveLimit > 0 ? enriched.slice(0, effectiveLimit) : enriched
        const limitNote = effectiveLimit > 0 && totalCount > effectiveLimit
          ? `\nShowing ${effectiveLimit} of ${totalCount}. Use limit=0 for all.`
          : ''
        return {
          content: [{
            type: 'text' as const,
            text: enriched.length === 0
              ? 'No contributions found matching filters'
              : `${totalCount} contribution(s) found:${limitNote}\n${JSON.stringify(limited, null, 2)}`,
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
