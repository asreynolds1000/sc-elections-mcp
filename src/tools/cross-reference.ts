import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  searchFilersByCounty,
  groupFilersByPerson,
  tokenMatch,
  enrichGroupedFilersWithCampaignData,
} from '../api/ethics-client.js'
import { searchCandidates } from '../api/vrems-client.js'
import { resolveCountyCode, resolveCountyName } from '../data/sc-counties.js'
import type { GroupedFiler, VremsCandidate } from '../types.js'

const SUFFIX_PATTERN = /\s*(jr\.?|sr\.?|ii|iii|iv)$/i

/**
 * Normalize an Ethics "Last, First [Middle]" candidate string to a "last|first" match key.
 * Drops middle name, strips common suffixes from the last name token.
 * Uses pipe-delimited "last|first" (not "first last") to avoid partial substring collisions.
 * Distinct from normalizeDonorName (which produces "first last") — this is for identity
 * keying across two systems, not donor deduplication within one system.
 * @internal — exported for testing
 */
export function normalizeEthicsName(candidate: string): string {
  const parts = candidate.split(',').map(p => p.trim().toLowerCase())
  if (parts.length >= 2) {
    const last = parts[0].replace(SUFFIX_PATTERN, '').trim()
    const first = parts[1].split(/\s+/)[0] // first word only, drops middle name
    return `${last}|${first}`
  }
  return candidate.toLowerCase()
}

/**
 * Normalize a VREMS firstName + lastName to a "last|first" match key.
 * Strips common suffixes from lastName (may be embedded if VREMS omits the separate suffix field).
 * @internal — exported for testing
 */
export function normalizeVremsName(firstName: string, lastName: string): string {
  const last = lastName.toLowerCase().replace(SUFFIX_PATTERN, '').trim()
  const first = firstName.toLowerCase().split(/\s+/)[0]
  return `${last}|${first}`
}

/**
 * Diff Ethics open campaigns against VREMS active candidates by normalized name key.
 * Returns three buckets plus the Maps so callers can build matched-pair output.
 * @internal — exported for testing
 */
export function diffEthicsVrems(
  ethicsOpen: GroupedFiler[],
  vremsActive: VremsCandidate[],
): {
  expectedNotFiled: Array<{ candidate: string; officeName: string; campaignId: number | undefined; balance: number | undefined; candidateFilerId: number }>
  filedNotInEthics: Array<{ firstName: string; lastName: string; office: string; party: string; dateFiled: string; filingLocation: string; matchNote: string }>
  matchedCount: number
  matchedKeys: Set<string>
  ethicsMap: Map<string, GroupedFiler>
  vremsMap: Map<string, VremsCandidate>
} {
  const ethicsMap = new Map<string, GroupedFiler>()
  for (const gf of ethicsOpen) {
    const key = normalizeEthicsName(gf.candidate)
    if (key) ethicsMap.set(key, gf)
  }

  const vremsMap = new Map<string, VremsCandidate>()
  for (const c of vremsActive) {
    const key = normalizeVremsName(c.firstName, c.lastName)
    if (key) vremsMap.set(key, c)
  }

  const matchedKeys = new Set([...ethicsMap.keys()].filter(k => vremsMap.has(k)))

  const expectedNotFiled = [...ethicsMap.entries()]
    .filter(([k]) => !matchedKeys.has(k))
    .map(([, gf]) => ({
      candidate: gf.candidate,
      officeName: gf.primaryOfficeName || gf.offices[0]?.officeName || '',
      campaignId: gf.campaignId,
      balance: gf.balance,
      candidateFilerId: gf.candidateFilerId,
    }))

  const filedNotInEthics = [...vremsMap.entries()]
    .filter(([k]) => !matchedKeys.has(k))
    .map(([, c]) => ({
      firstName: c.firstName,
      lastName: c.lastName,
      office: c.office,
      party: c.party,
      dateFiled: c.dateFiled,
      filingLocation: c.filingLocation,
      matchNote: 'No matching Ethics open campaign — may be new candidate or name variant',
    }))

  return { expectedNotFiled, filedNotInEthics, matchedCount: matchedKeys.size, matchedKeys, ethicsMap, vremsMap }
}

export function registerCrossReferenceTools(server: McpServer) {
  server.tool(
    'find_expected_filers',
    'Cross-reference SC Ethics Commission open campaign accounts with VREMS ballot filings for a county. Answers "who has an Ethics account but hasn\'t filed on the ballot yet?" during a filing period. Returns three buckets: expectedNotFiled (Ethics open campaign, no VREMS match), filedNotInEthics (VREMS active, no Ethics open match), matched count (use show_matched=true to see pairs). Name matching is best-effort last+first token — false negatives possible for nicknames (Bob/Robert), hyphenated surnames, and data-entry differences between systems. Ethics sweep cached 30 min; VREMS query is live on each call. Takes 15-25 seconds on first call.',
    {
      county: z.string().describe('County name (e.g. "Greenville") or code (e.g. "23")'),
      election_id: z.string().regex(/^\d+$/, 'Election ID must be numeric').describe('VREMS election ID from list_elections'),
      office_type: z.string().optional().describe('Token filter applied to both Ethics and VREMS sides (e.g. "County Council", "Sheriff"). Order-independent. Omit for all offices.'),
      status: z.string().optional().describe('VREMS status filter (default: "Active"). Pass "All" to include withdrew candidates.'),
      show_matched: z.boolean().optional().describe('If true, include matched pairs in output (capped at 20). Default false — keeps output concise.'),
    },
    async ({ county, election_id, office_type, status, show_matched }) => {
      try {
        const countyName = resolveCountyName(county)
        if (!countyName) {
          return {
            content: [{ type: 'text' as const, text: `Unknown county: "${county}". Use a SC county name like "Greenville" or a numeric code like "23".` }],
            isError: true,
          }
        }
        const countyCode = resolveCountyCode(county)! // safe: resolveCountyCode and resolveCountyName both index SC_COUNTY_NAMES

        // ── Step 1: Ethics open campaigns for this county ───────────────────
        const ethicsResult = await searchFilersByCounty(countyName)
        let { filers } = ethicsResult

        // Filter to last 2 years
        const cutoff = Date.now() - (2 * 365.25 * 24 * 60 * 60 * 1000)
        filers = filers.filter(f => {
          if (!f.lastSubmission) return false
          const [month, day, year] = f.lastSubmission.split('/')
          return new Date(+year, +month - 1, +day).getTime() >= cutoff
        })

        const grouped = groupFilersByPerson(filers)

        // Enrich with campaign data (batches of 6, cap 50) — mutates grouped in-place
        const wasCapped = await enrichGroupedFilersWithCampaignData(grouped)

        // Filter to open campaigns only
        let ethicsOpen: GroupedFiler[] = grouped.filter(gf => gf.campaignStatus === 'open')

        // Apply office_type filter if provided
        if (office_type) {
          ethicsOpen = ethicsOpen.filter(gf =>
            gf.offices.some(o => tokenMatch(office_type, o.officeName)) ||
            tokenMatch(office_type, gf.primaryOfficeName || '')
          )
        }

        // ── Step 2: VREMS active candidates for this election + county ───────
        const vremsResult = await searchCandidates({
          electionId: election_id,
          county: countyCode,
          status: status || 'Active',
        })

        // Require CSV path — fallback HTML lacks firstName/lastName fields needed for name matching
        if (vremsResult.candidates.length === 0 && vremsResult.fallback?.length) {
          return {
            content: [{ type: 'text' as const, text: 'VREMS CSV export unavailable (session fallback triggered). Name-matching cross-reference requires structured CSV data with separate firstName/lastName fields. Try again in a few seconds.' }],
            isError: true,
          }
        }

        let vremsActive: VremsCandidate[] = vremsResult.candidates
        if (office_type) {
          vremsActive = vremsActive.filter(c => tokenMatch(office_type, c.office || ''))
        }

        // ── Step 3: Diff by normalized name key ──────────────────────────────
        const { expectedNotFiled, filedNotInEthics, matchedCount, matchedKeys, ethicsMap, vremsMap } =
          diffEthicsVrems(ethicsOpen, vremsActive)

        const matchedPairs = show_matched
          ? [...matchedKeys].slice(0, 20).map(k => {
              const gf = ethicsMap.get(k)!
              const c = vremsMap.get(k)!
              return {
                ethics: {
                  candidate: gf.candidate,
                  officeName: gf.primaryOfficeName || gf.offices[0]?.officeName || '',
                  campaignId: gf.campaignId,
                  balance: gf.balance,
                },
                vrems: {
                  firstName: c.firstName,
                  lastName: c.lastName,
                  office: c.office,
                  dateFiled: c.dateFiled,
                },
              }
            })
          : []

        const output = {
          summary: {
            county: countyName,
            electionId: election_id,
            officeTypeFilter: office_type || null,
            ethicsOpenCount: ethicsOpen.length,
            vremsActiveCount: vremsActive.length,
            matchedCount,
            expectedNotFiledCount: expectedNotFiled.length,
            filedNotInEthicsCount: filedNotInEthics.length,
            ...(wasCapped
              ? { enrichmentNote: 'Ethics enrichment capped at 50 filers; results may be incomplete' }
              : {}),
            ...(ethicsResult.totalFailed > 0
              ? { ethicsSweepNote: `${ethicsResult.totalFailed} of 26 Ethics searches failed; results may be incomplete` }
              : {}),
          },
          expectedNotFiled,
          filedNotInEthics,
          matched: matchedPairs,
          matchingCaveats: 'Name matching uses last+first token only. Common names (multiple people with identical first+last) will silently collide — only one will appear in results. False negatives also expected for nickname variants (Bob/Robert), hyphenated surnames, and data-entry differences.',
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(output, null, 2) }],
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
