import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { searchFilers, getFilerProfile, searchFilersByOffice, searchFilersByCounty, groupFilersByPerson, normalizeOfficeName, listOfficeNames, tokenMatch, enrichGroupedFilersWithCampaignData } from '../api/ethics-client.js'
import { resolveCountyName } from '../data/sc-counties.js'
import type { GroupedFiler } from '../types.js'

export function registerSearchTools(server: McpServer) {
  server.tool(
    'search_filers',
    'Search SC Ethics Commission for candidates and officials by name. Returns candidateFilerId and seiFilerId needed for other tools. Default limit 50 results (0 for all). WARNING: The API searches the combined "Last, First" field — multi-word queries like "John Smith" may fail. Search by last name only for best results. To find all filers for a specific office, use list_filers_by_office. To discover valid office name formats, use list_office_names.',
    {
      name: z.string().describe('Name to search for (e.g. "mcmaster", "haley"). Use last name only for best results.'),
      office: z.string().optional().describe('Filter results by office name using token matching (e.g. "City Council", "Water", "House"). Applied client-side after search.'),
      limit: z.number().optional().describe('Max results to return (default 50, 0 for all). Common names can return 200+ results.'),
    },
    async ({ name, office, limit }) => {
      try {
        const allResults = await searchFilers(name)
        let results = allResults
        if (office) {
          results = results.filter(r => tokenMatch(office, r.officeName || ''))
        }
        if (results.length === 0) {
          const message = office && allResults.length > 0
            ? [
                `Found ${allResults.length} filer(s) named "${name}", but none matched office filter "${office}".`,
                `Try a broader office filter, or omit it to see all offices for this name.`,
                `Use list_office_names to discover valid office name formats.`,
              ]
            : [
                `No Ethics Commission filers found for "${name}".`,
                `The API does exact last-name matching — try a shorter or different spelling.`,
                `Search VREMS via search_candidates for current ballot filings.`,
                `Use list_filers_by_office if you know the office they're running for.`,
              ]
          return {
            content: [{
              type: 'text' as const,
              text: message.join('\n'),
            }],
          }
        }

        const effectiveLimit = limit === undefined ? 50 : limit
        const totalCount = results.length
        const limited = effectiveLimit > 0 ? results.slice(0, effectiveLimit) : results
        const grouped = groupFilersByPerson(limited)

        // Enrich with normalized office names so district numbers are visible
        for (const gf of grouped) {
          if (!gf.normalizedOffice) {
            gf.normalizedOffice = normalizeOfficeName(gf.offices[0]?.officeName || '')
          }
        }

        const limitNote = effectiveLimit > 0 && totalCount > effectiveLimit
          ? `Showing ${grouped.length} grouped from ${effectiveLimit} of ${totalCount} results. Use limit=0 for all.\n`
          : ''
        return {
          content: [{
            type: 'text' as const,
            text: `${limitNote}${JSON.stringify(grouped, null, 2)}`,
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
    'Find all candidates/officials who have filed with the SC Ethics Commission for a specific office. Searches the entire filer database by sweeping all 26 letters and filtering by office name. Returns grouped results — one entry per person with an offices[] sub-array showing all their filings. May take 10-15 seconds on first call (cached 30 min after). With recent_only=true, enriches results with campaignId, balance, status, and initialReportFiledDate — no need to call get_campaign_summary separately. With active_only=true, returns only filers with an open campaign account (implies recent_only). Use jurisdiction filter to distinguish city vs county offices (e.g. jurisdiction="county" for Greenville County Council, jurisdiction="city" for Greenville City Council).',
    {
      office: z.string().describe('Office name to search for (partial match, e.g. "Greenville County Council", "Governor", "Sheriff")'),
      recent_only: z.boolean().optional().describe('If true, only return filers with submissions in the last 2 years and enrich with campaign data. Default: false.'),
      active_since: z.number().optional().describe('Only include filers with submissions on or after this year (e.g. 2022). More precise than recent_only.'),
      active_only: z.boolean().optional().describe('If true, return only filers with an open campaign account. Implies recent_only=true. Cuts noise from closed/historical campaigns.'),
      jurisdiction: z.enum(['city', 'county', 'state']).optional().describe('Filter by jurisdiction tier derived from office type. city=City Council/Mayor, county=County Council/Sheriff/Auditor/etc, state=State House/Senate/Governor/etc. Useful when a query like "Greenville" returns both city and county offices.'),
    },
    async ({ office, recent_only, active_since, active_only, jurisdiction }) => {
      try {
        const result = await searchFilersByOffice(office, active_since)
        let { filers } = result

        // active_only implies recent_only (needs enrichment to get campaignStatus)
        const needsEnrichment = recent_only || active_only

        if (needsEnrichment) {
          const cutoff = Date.now() - (2 * 365.25 * 24 * 60 * 60 * 1000)
          filers = filers.filter(f => {
            if (!f.lastSubmission) return false
            const [month, day, year] = f.lastSubmission.split('/')
            return new Date(+year, +month - 1, +day).getTime() >= cutoff
          })
        }

        // Group filers by person (dedup + merge offices)
        let grouped = groupFilersByPerson(filers)

        // Enrich with campaign data when recent_only or active_only
        let enrichmentNote = ''
        if (needsEnrichment && grouped.length > 0) {
          const wasCapped = await enrichGroupedFilersWithCampaignData(grouped, office)
          if (wasCapped) enrichmentNote = `\nNote: Enriched 50 of ${grouped.length} filers with campaign data. Use a more specific query for remaining.`
        }

        // Apply active_only filter (needs enrichment data)
        if (active_only) {
          grouped = grouped.filter(gf => gf.campaignStatus === 'open')
        }

        // Apply jurisdiction filter — compute normalizedOffice if not already set
        if (jurisdiction) {
          for (const gf of grouped) {
            if (!gf.normalizedOffice) {
              gf.normalizedOffice = normalizeOfficeName(gf.offices[0]?.officeName || '')
            }
          }
          grouped = grouped.filter(gf => gf.normalizedOffice?.jurisdictionTier === jurisdiction)
        }

        const parts: string[] = []
        if (result.totalFailed > 0) {
          parts.push(`Note: ${result.totalFailed} of 26 searches failed; results may be incomplete.`)
        }
        if (grouped.length === 0) {
          parts.push([
            `No filers found for office matching "${office}"${needsEnrichment ? ' (with recent_only filter)' : ''}${active_only ? ' with open campaign' : ''}${jurisdiction ? ` with jurisdiction="${jurisdiction}"` : ''}.`,
            `Use list_office_names to find exact office name strings.`,
            `For district-based offices, include the district number (e.g. "Greenville County Council District 17").`,
            `Check VREMS via search_candidates for current ballot filings.`,
          ].join('\n'))
        } else {
          if (needsEnrichment) {
            parts.push('=== ENRICHED RESULTS ===\nThese results include campaignId, balance, and campaign status for each filer.\nDo NOT call get_campaign_summary for these filers — the data is already included below.\n===')
          }
          parts.push(`${grouped.length} filer(s) found for "${office}"${needsEnrichment ? ' (last 2 years)' : ''}${active_only ? ' (active campaigns only)' : ''}${jurisdiction ? ` (${jurisdiction} offices only)` : ''}:${enrichmentNote}`)
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
    'list_filers_by_county',
    'Find all candidates/officials who have filed with the SC Ethics Commission in a specific county. Matches by county name in office name (e.g. "Greenville County Council", "Greenville Sheriff") OR by city-to-county mapping from filer address. Returns grouped results like list_filers_by_office. First call may take 10-15 seconds (alphabet sweep). Results cached 30 minutes. City-to-county mapping covers incorporated municipalities; some rural addresses may not match. NOTE: Results mix city-level and county-level offices (e.g. Greenville City Council and Greenville County Council both appear). Use jurisdiction="county" to see only county offices, or jurisdiction="city" for city offices.',
    {
      county: z.string().describe('County name (e.g. "Greenville", "Richland", "Charleston")'),
      recent_only: z.boolean().optional().describe('If true, only return filers with submissions in the last 2 years and enrich with campaign data. Default: false.'),
      active_since: z.number().optional().describe('Only include filers with submissions on or after this year (e.g. 2022).'),
      office_type: z.string().optional().describe('Filter by office type using token matching (e.g. "County Council", "Sheriff", "House"). Order-independent.'),
      active_only: z.boolean().optional().describe('If true, return only filers with an open campaign account. Implies recent_only=true. Cuts results from ~46 to ~12 for a typical county by removing closed/historical campaigns.'),
      jurisdiction: z.enum(['city', 'county', 'state']).optional().describe('Filter by jurisdiction tier. city=City Council/Mayor, county=County Council/Sheriff/Auditor/etc, state=State House/Senate. Solves the city vs county conflation: Greenville has both a City Council and a County Council.'),
    },
    async ({ county, recent_only, active_since, office_type, active_only, jurisdiction }) => {
      try {
        const countyName = resolveCountyName(county)
        if (!countyName) {
          return {
            content: [{ type: 'text' as const, text: `Unknown county: "${county}". Use a SC county name like "Greenville" or a numeric code like "23".` }],
            isError: true,
          }
        }

        const result = await searchFilersByCounty(countyName, active_since)
        let { filers } = result

        // active_only implies recent_only (needs enrichment to get campaignStatus)
        const needsEnrichment = recent_only || active_only

        if (needsEnrichment) {
          const cutoff = Date.now() - (2 * 365.25 * 24 * 60 * 60 * 1000)
          filers = filers.filter(f => {
            if (!f.lastSubmission) return false
            const [month, day, year] = f.lastSubmission.split('/')
            return new Date(+year, +month - 1, +day).getTime() >= cutoff
          })
        }

        const grouped = groupFilersByPerson(filers)

        // Filter by office type if specified
        let filtered = office_type
          ? grouped.filter(gf => gf.offices.some(o => tokenMatch(office_type, o.officeName)))
          : grouped

        // Enrich with campaign data when needed
        let enrichmentNote = ''
        if (needsEnrichment && filtered.length > 0) {
          const wasCapped = await enrichGroupedFilersWithCampaignData(filtered)
          if (wasCapped) enrichmentNote = `\nNote: Enriched 50 of ${filtered.length} filers with campaign data. Use a more specific query for remaining.`
        }

        // Apply active_only filter (needs enrichment data)
        if (active_only) {
          filtered = filtered.filter(gf => gf.campaignStatus === 'open')
        }

        // Apply jurisdiction filter — compute normalizedOffice if not already set
        if (jurisdiction) {
          for (const gf of filtered) {
            if (!gf.normalizedOffice) {
              gf.normalizedOffice = normalizeOfficeName(gf.offices[0]?.officeName || '')
            }
          }
          filtered = filtered.filter(gf => gf.normalizedOffice?.jurisdictionTier === jurisdiction)
        }

        const parts: string[] = []
        if (result.totalFailed > 0) {
          parts.push(`Note: ${result.totalFailed} of 26 searches failed; results may be incomplete.`)
        }
        if (filtered.length === 0) {
          parts.push(`No filers found in ${countyName} County${office_type ? ` matching office type "${office_type}"` : ''}${needsEnrichment ? ' (last 2 years)' : ''}${active_only ? ' with open campaign' : ''}${jurisdiction ? ` with jurisdiction="${jurisdiction}"` : ''}`)
        } else {
          if (needsEnrichment) {
            parts.push('=== ENRICHED RESULTS ===\nThese results include campaignId, balance, and campaign status for each filer.\nDo NOT call get_campaign_summary for these filers — the data is already included below.\n===')
          }
          parts.push(`${filtered.length} filer(s) found in ${countyName} County${office_type ? ` matching "${office_type}"` : ''}${needsEnrichment ? ' (last 2 years)' : ''}${active_only ? ' (active campaigns only)' : ''}${jurisdiction ? ` (${jurisdiction} offices only)` : ''}:${enrichmentNote}`)
          parts.push(JSON.stringify(filtered, null, 2))
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
