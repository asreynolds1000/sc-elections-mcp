import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { searchFilers, getFilerProfile, searchFilersByOffice, groupFilersByPerson, cachedGetCampaignSummary, normalizeOfficeName, listOfficeNames } from '../api/ethics-client.js'
import type { GroupedFiler } from '../types.js'

export function registerSearchTools(server: McpServer) {
  server.tool(
    'search_filers',
    'Search SC Ethics Commission for candidates and officials by name. Returns candidateFilerId and seiFilerId needed for other tools. Default limit 50 results (0 for all). WARNING: The API searches the combined "Last, First" field — multi-word queries like "John Smith" may fail. Search by last name only for best results. To find all filers for a specific office, use list_filers_by_office. To discover valid office name formats, use list_office_names.',
    {
      name: z.string().describe('Name to search for (e.g. "mcmaster", "haley"). Use last name only for best results.'),
      limit: z.number().optional().describe('Max results to return (default 50, 0 for all). Common names can return 200+ results.'),
    },
    async ({ name, limit }) => {
      try {
        const results = await searchFilers(name)
        const effectiveLimit = limit === undefined ? 50 : limit
        const totalCount = results.length
        const limited = effectiveLimit > 0 ? results.slice(0, effectiveLimit) : results
        const limitNote = effectiveLimit > 0 && totalCount > effectiveLimit
          ? `Showing ${effectiveLimit} of ${totalCount} results. Use limit=0 for all.\n`
          : ''
        return {
          content: [{
            type: 'text' as const,
            text: results.length === 0
              ? `No filers found matching "${name}"`
              : `${limitNote}${JSON.stringify(limited, null, 2)}`,
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
    'list_filers_by_office',
    'Find all candidates/officials who have filed with the SC Ethics Commission for a specific office. Searches the entire filer database by sweeping all 26 letters and filtering by office name. Returns grouped results — one entry per person with an offices[] sub-array showing all their filings. May take 10-15 seconds on first call (cached 30 min after). With recent_only=true, enriches results with campaignId, balance, and status — no need to call get_campaign_summary separately.',
    {
      office: z.string().describe('Office name to search for (partial match, e.g. "Greenville County Council", "Governor", "Sheriff")'),
      recent_only: z.boolean().optional().describe('If true, only return filers with submissions in the last 2 years and enrich with campaign data. Default: false.'),
      active_since: z.number().optional().describe('Only include filers with submissions on or after this year (e.g. 2022). More precise than recent_only.'),
    },
    async ({ office, recent_only, active_since }) => {
      try {
        const result = await searchFilersByOffice(office, active_since)
        let { filers } = result

        if (recent_only) {
          const cutoff = Date.now() - (2 * 365.25 * 24 * 60 * 60 * 1000)
          filers = filers.filter(f => {
            if (!f.lastSubmission) return false
            const [month, day, year] = f.lastSubmission.split('/')
            return new Date(+year, +month - 1, +day).getTime() >= cutoff
          })
        }

        // Group filers by person (dedup + merge offices)
        const grouped = groupFilersByPerson(filers)

        // Enrich with campaign data when recent_only
        let enrichmentNote = ''
        if (recent_only && grouped.length > 0) {
          const ENRICH_CAP = 50
          const BATCH_SIZE = 6
          const toEnrich = grouped.slice(0, ENRICH_CAP)
          const needle = office.toLowerCase()

          for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
            const batch = toEnrich.slice(i, i + BATCH_SIZE)
            await Promise.allSettled(
              batch.map(async (gf) => {
                const summary = await cachedGetCampaignSummary(gf.candidateFilerId)
                const allOffices = [
                  ...summary.openReports.map(r => ({ ...r, status: 'open' as const })),
                  ...summary.closedReports.map(r => ({ ...r, status: 'closed' as const })),
                ]
                // Find best matching office: prefer open, then most recent
                const matches = allOffices.filter(o => o.officeName.toLowerCase().includes(needle))
                const match = matches.find(o => o.status === 'open') || matches[0]
                gf.normalizedOffice = normalizeOfficeName(gf.offices[0]?.officeName || '')
                if (match) {
                  gf.primaryOfficeName = match.officeName
                  gf.campaignStatus = match.status
                  gf.balance = match.balance
                  gf.campaignId = match.officeId
                }
              })
            )
          }
          if (grouped.length > ENRICH_CAP) {
            enrichmentNote = `\nNote: Enriched ${ENRICH_CAP} of ${grouped.length} filers with campaign data. Use a more specific query for remaining.`
          }
        }

        const parts: string[] = []
        if (result.totalFailed > 0) {
          parts.push(`Note: ${result.totalFailed} of 26 searches failed; results may be incomplete.`)
        }
        if (grouped.length === 0) {
          parts.push(`No filers found for office matching "${office}"${recent_only ? ' (with recent_only filter)' : ''}`)
        } else {
          if (recent_only) {
            parts.push('=== ENRICHED RESULTS ===\nThese results include campaignId, balance, and campaign status for each filer.\nDo NOT call get_campaign_summary for these filers — the data is already included below.\n===')
          }
          parts.push(`${grouped.length} filer(s) found for "${office}"${recent_only ? ' (last 2 years)' : ''}:${enrichmentNote}`)
          parts.push(JSON.stringify(grouped, null, 2))
        }

        return {
          content: [{ type: 'text' as const, text: parts.join('\n') }],
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
    'get_filer_profile',
    'Get full profile for a filer including address, phone, positions held, and open/closed campaign offices. Use candidateFilerId and seiFilerId from search_filers. Returns campaignId (in openOffices/closedOffices) for campaign finance tools.',
    {
      candidate_filer_id: z.number().describe('candidateFilerId from search_filers results'),
      sei_filer_id: z.number().describe('seiFilerId from search_filers results'),
    },
    async ({ candidate_filer_id, sei_filer_id }) => {
      try {
        const profile = await getFilerProfile(candidate_filer_id, sei_filer_id)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(profile, null, 2) }],
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
    'list_office_names',
    'List distinct office names from the SC Ethics Commission filer database. Returns exact office name strings — use these with list_filers_by_office for precise matching. Optional keyword filter (e.g. "House", "Senate", "Greenville"). First call triggers a database sweep (~10-15 sec); subsequent calls are instant from cache. NOTE: These are filer-reported names and may differ slightly from campaign-level names used in get_contributions/get_expenditures office hints. Use for discovery and partial matching.',
    {
      keyword: z.string().optional().describe('Filter office names containing this keyword (case-insensitive, e.g. "House", "Senate", "Greenville")'),
    },
    async ({ keyword }) => {
      try {
        const names = await listOfficeNames(keyword)
        return {
          content: [{
            type: 'text' as const,
            text: names.length === 0
              ? `No office names found${keyword ? ` matching "${keyword}"` : ''}`
              : `${names.length} office name(s)${keyword ? ` matching "${keyword}"` : ''}:\n${JSON.stringify(names, null, 2)}`,
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
