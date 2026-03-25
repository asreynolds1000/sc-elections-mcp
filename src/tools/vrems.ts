import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getElectionYears, getElections, searchCandidates, getCandidateDetailHtml } from '../api/vrems-client.js'
import { parseCandidateDetail } from '../parsers/candidate-detail.js'
import { resolveCountyCode } from '../data/sc-counties.js'

export function registerVremsTools(server: McpServer) {
  server.tool(
    'list_elections',
    'List SC elections by type and year. Returns election IDs needed for search_candidates. Types: General (statewide primaries + general), Special, Local. Use keyword to filter by location or type (e.g. "Sumter", "Primary"). Default limit 50 results (0 for all) — Local elections can have 200+ entries statewide. Start here for race research.',
    {
      election_type: z.enum(['General', 'Special', 'Local']).describe('Election type'),
      year: z.number().optional().describe('Specific year. Omit to get available years for this type.'),
      keyword: z.string().optional().describe('Filter election names containing this keyword (case-insensitive, e.g. "Sumter", "Greenville", "Primary")'),
      limit: z.number().optional().describe('Max results to return (default 50, 0 for all). Local elections can have 200+ entries per year.'),
    },
    async ({ election_type, year, keyword, limit }) => {
      try {
        if (year) {
          let elections = await getElections(election_type, year)

          // Apply keyword filter
          if (keyword) {
            const needle = keyword.toLowerCase()
            elections = elections.filter((e: any) =>
              (e.electionName || '').toLowerCase().includes(needle) ||
              (e.displayName || '').toLowerCase().includes(needle)
            )
          }

          // Apply limit
          const effectiveLimit = limit === undefined ? 50 : limit
          const totalCount = elections.length
          const limited = effectiveLimit > 0 ? elections.slice(0, effectiveLimit) : elections
          const limitNote = effectiveLimit > 0 && totalCount > effectiveLimit
            ? `\nShowing ${effectiveLimit} of ${totalCount}. Use limit=0 for all.`
            : ''

          return {
            content: [{
              type: 'text' as const,
              text: limited.length === 0
                ? `No ${election_type} elections found for ${year}${keyword ? ` matching "${keyword}"` : ''}`
                : `${totalCount} election(s)${keyword ? ` matching "${keyword}"` : ''}:${limitNote}\n${JSON.stringify(limited, null, 2)}`,
            }],
          }
        } else {
          const years = await getElectionYears(election_type)
          return {
            content: [{
              type: 'text' as const,
              text: years.length === 0
                ? `No years found for ${election_type} elections`
                : `Available years for ${election_type} elections:\n${JSON.stringify(years, null, 2)}`,
            }],
          }
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
    'search_candidates',
    'Search for candidates in a specific SC election. Returns contact info, filing fee, address, status, dateFiled. Default limit 50 results (0 for all) — statewide elections can return 500+. Get election_id from list_elections. To bridge to campaign finance, use search_filers with candidate names — the two systems don\'t share IDs. Try last name only if no match. ELECTION ID NOTE: County council candidates (nonpartisan) file under the General election ID, not the Primary. State House candidates also use the General election ID even though they have primaries. Use list_elections to confirm IDs for each cycle.',
    {
      election_id: z.string().describe('Election ID from list_elections results'),
      office: z.string().optional().describe('Office filter. IMPORTANT: Text matching is unreliable — use numeric codes for reliable filtering. Known codes: 380=State House, 379=State Senate, 469=County Council District, 405=County Council Chair, 399=Probate Judge, 403=County Treasurer, 398=Sheriff, 400=Clerk of Court, 401=Coroner, 402=Auditor, 473=County Council At Large. Statewide office codes are not fully documented — for Governor, AG, and other statewide offices, omit this filter and search by last_name instead. Omit for ALL offices (recommended for county-level queries). Use -1 explicitly for all.'),
      county: z.string().optional().describe('County name (e.g. "Greenville") or code (e.g. "23"). Names are auto-resolved to codes. Omit for all counties.'),
      party: z.string().optional().describe('Party filter: Republican, Democratic, Libertarian, Nonpartisan, or All. Note: "United Citizens" party candidates exist but are not listed here — omit party filter to see all.'),
      status: z.string().optional().describe('Status filter. Known values: Active (filed, not withdrawn), Elected (won the race), DefeatedInPrimary, DefeatedInGeneral, Withdrew (filed then withdrew — use this to exclude dropped candidates). Omit or pass All for everyone.'),
      first_name: z.string().optional().describe('Candidate first name search'),
      last_name: z.string().optional().describe('Candidate last name search'),
      date_filed: z.string().optional().describe('Filter by filing date to get only candidates who filed on that day. Format must match what VREMS returns (typically M/D/YYYY without leading zeros, e.g. "3/18/2026"). Use this during filing periods to pull only today\'s new filers without fetching the full candidate list. Note: only applies to CSV results — ignored in HTML fallback mode.'),
      limit: z.number().optional().describe('Max candidates to return (default 50, 0 for all). Statewide elections can return hundreds.'),
    },
    async ({ election_id, office, county, party, status, first_name, last_name, date_filed, limit }) => {
      try {
        // Resolve county name to code if not already numeric
        let resolvedCounty = county
        if (county && !/^\d+$/.test(county)) {
          resolvedCounty = resolveCountyCode(county)
          if (!resolvedCounty) {
            return {
              content: [{ type: 'text' as const, text: `Unknown county: "${county}". Use a SC county name like "Greenville" or a numeric code like "23".` }],
              isError: true,
            }
          }
        }

        const result = await searchCandidates({
          electionId: election_id,
          office,
          county: resolvedCounty,
          party,
          status,
          firstName: first_name,
          lastName: last_name,
        })

        const effectiveLimit = limit === undefined ? 50 : limit

        if (result.candidates.length > 0) {
          let candidates = result.candidates

          // Apply date_filed filter (client-side — CSV always returns all dates)
          if (date_filed) {
            candidates = candidates.filter(c => (c.dateFiled || '') === date_filed)
          }

          const totalCount = candidates.length
          const limited = effectiveLimit > 0 ? candidates.slice(0, effectiveLimit) : candidates
          const limitNote = effectiveLimit > 0 && totalCount > effectiveLimit
            ? `\nShowing ${effectiveLimit} of ${totalCount}. Use limit=0 for all.`
            : ''
          return {
            content: [{
              type: 'text' as const,
              text: totalCount === 0
                ? `No candidates found matching filters${date_filed ? ` (no filings on ${date_filed})` : ''}`
                : `${totalCount} candidate(s) found (rich data from CSV export):${limitNote}\n${JSON.stringify(limited, null, 2)}`,
            }],
          }
        }

        if (result.fallback && result.fallback.length > 0) {
          const totalCount = result.fallback.length
          const limited = effectiveLimit > 0 ? result.fallback.slice(0, effectiveLimit) : result.fallback
          const limitNote = effectiveLimit > 0 && totalCount > effectiveLimit
            ? `\nShowing ${effectiveLimit} of ${totalCount}. Use limit=0 for all.`
            : ''
          const dateWarning = date_filed
            ? `\nWARNING: date_filed filter "${date_filed}" was ignored — CSV export is unavailable and HTML fallback does not support date filtering. Results are unfiltered.`
            : ''
          return {
            content: [{
              type: 'text' as const,
              text: `${totalCount} candidate(s) found (basic data from HTML — CSV export unavailable):${dateWarning}${limitNote}\n${JSON.stringify(limited, null, 2)}`,
            }],
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: [
              `No VREMS candidates found for this election/filter combination.`,
              `Try a different election_id — use list_elections to find the right one.`,
              `Remove name filters to see all candidates for the office.`,
              `Check the Ethics Commission via search_filers.`,
            ].join('\n'),
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
    'get_candidate_details',
    'Get filing details for a specific candidate: address, filing date, status, document links (filing form PDF, fee receipt). Use candidateId and electionId from search_candidates. candidateId is only available from HTML results, not CSV export.',
    {
      candidate_id: z.string().describe('Candidate ID from search_candidates results'),
      election_id: z.string().describe('Election ID from list_elections or search_candidates results'),
    },
    async ({ candidate_id, election_id }) => {
      try {
        const html = await getCandidateDetailHtml(candidate_id, election_id)
        const detail = parseCandidateDetail(html)

        if (!detail.name) {
          return {
            content: [{ type: 'text' as const, text: 'Could not parse candidate detail page. The page structure may have changed.' }],
            isError: true,
          }
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(detail, null, 2) }],
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
