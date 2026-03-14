import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { cachedGetCampaignSummary, resolveCampaignContext, resolveCandidateName, resolveByName, getContributions, searchFilersByOffice, groupFilersByPerson } from '../api/ethics-client.js'
import type { CampaignContribution } from '../types.js'

/** @internal — exported for testing */
export interface CandidateContributions {
  candidateFilerId: number
  candidateName: string
  officeName: string
  contributions: CampaignContribution[]
  error?: string
}

interface DonorOverlapEntry {
  donorName: string
  totalGiven: number
  candidateBreakdown: {
    candidateName: string
    officeName: string
    amount: number
    count: number
  }[]
}

async function fetchCandidateContributions(
  candidateFilerId: number,
  campaignId?: number,
  officeHint?: string,
): Promise<CandidateContributions> {
  try {
    const summary = await cachedGetCampaignSummary(candidateFilerId)
    // Resolve candidate name when summary.name is null
    let candidateNameOverride: string | undefined
    if (!summary.name) {
      candidateNameOverride = await resolveCandidateName(candidateFilerId)
    }
    const resolved = resolveCampaignContext(summary, candidateFilerId, campaignId, officeHint, candidateNameOverride)
    if ('error' in resolved) {
      return { candidateFilerId, candidateName: 'Unknown', officeName: 'Unknown', contributions: [], error: resolved.error }
    }
    const contributions = await getContributions(resolved.resolvedCampaignId, resolved.resolvedFilerId)
    return {
      candidateFilerId,
      candidateName: resolved.context.candidateName,
      officeName: resolved.context.officeName,
      contributions,
    }
  } catch (err) {
    return {
      candidateFilerId,
      candidateName: 'Unknown',
      officeName: 'Unknown',
      contributions: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

const SUFFIXES = /\b(jr|sr|ii|iii|iv|v|md|dds|esq|phd|cpa)\.?$/i

export function normalizeDonorName(name: string): string {
  let n = name.trim().toLowerCase().replace(/\s+/g, ' ')
  // Remove periods from initials
  n = n.replace(/\./g, '')
  // Remove common suffixes
  n = n.replace(SUFFIXES, '').trim()
  // Normalize "Last, First" → "first last" for consistent matching
  if (n.includes(',')) {
    const [last, ...rest] = n.split(',')
    n = `${rest.join(' ').trim()} ${last.trim()}`.trim()
  }
  return n
}

/** @internal — exported for testing */
export function computeOverlap(
  primary: CandidateContributions,
  comparisons: CandidateContributions[],
  exactMatch = false,
): DonorOverlapEntry[] {
  const toKey = exactMatch
    ? (name: string) => name.trim().toLowerCase()
    : normalizeDonorName

  const primaryDonors = new Map<string, { display: string; amount: number; count: number }>()
  for (const c of primary.contributions) {
    const key = toKey(c.paidBy)
    const existing = primaryDonors.get(key)
    if (existing) {
      existing.amount += c.credit
      existing.count++
    } else {
      primaryDonors.set(key, { display: c.paidBy.trim(), amount: c.credit, count: 1 })
    }
  }

  const comparisonMaps = comparisons.map(comp => {
    const m = new Map<string, { display: string; amount: number; count: number }>()
    for (const c of comp.contributions) {
      const key = toKey(c.paidBy)
      const existing = m.get(key)
      if (existing) {
        existing.amount += c.credit
        existing.count++
      } else {
        m.set(key, { display: c.paidBy.trim(), amount: c.credit, count: 1 })
      }
    }
    return m
  })

  const overlapping: DonorOverlapEntry[] = []

  for (const [key, primaryData] of primaryDonors) {
    const breakdown: DonorOverlapEntry['candidateBreakdown'] = []
    let appearsInComparison = false

    breakdown.push({
      candidateName: primary.candidateName,
      officeName: primary.officeName,
      amount: primaryData.amount,
      count: primaryData.count,
    })

    for (let i = 0; i < comparisons.length; i++) {
      const compData = comparisonMaps[i].get(key)
      if (compData) {
        appearsInComparison = true
        breakdown.push({
          candidateName: comparisons[i].candidateName,
          officeName: comparisons[i].officeName,
          amount: compData.amount,
          count: compData.count,
        })
      }
    }

    if (appearsInComparison) {
      const totalGiven = breakdown.reduce((sum, b) => sum + b.amount, 0)
      overlapping.push({ donorName: primaryData.display, totalGiven, candidateBreakdown: breakdown })
    }
  }

  return overlapping.sort((a, b) => b.totalGiven - a.totalGiven)
}

export function registerOverlapTools(server: McpServer) {
  server.tool(
    'find_donor_overlap',
    'Find donors who contributed to multiple candidates. Three modes:\n1. By name: pass primary_name + comparison_names (resolves candidates automatically)\n2. By ID: pass primary_candidate_filer_id + comparison_candidate_filer_ids\n3. Office-based: pass primary ID/name + office to auto-discover comparison candidates (max 25)\nUse county param to disambiguate common names (e.g. county="Greenville"). Fetches contributions in parallel and computes intersection. Name matching normalizes "Last, First" vs "First Last", strips suffixes (Jr, Sr, etc), and is case-insensitive.',
    {
      primary_candidate_filer_id: z.number().optional().describe('candidateFilerId of the primary candidate. Optional if primary_name is provided.'),
      primary_name: z.string().optional().describe('Full name of primary candidate (e.g. "Steve Shaw"). Alternative to primary_candidate_filer_id — resolves the ID automatically.'),
      primary_campaign_id: z.number().optional().describe('campaignId for primary — optional, auto-resolved'),
      primary_office: z.string().optional().describe('Office hint for primary candidate'),
      comparison_candidate_filer_ids: z.array(z.number()).max(20).optional().describe('Array of up to 20 candidateFilerId values to compare against. Omit if using office param or comparison_names.'),
      comparison_names: z.array(z.string()).max(20).optional().describe('Names of candidates to compare (e.g. ["Jason Elliott", "Joe Smith"]). Alternative to comparison_candidate_filer_ids.'),
      county: z.string().optional().describe('County or city to disambiguate candidates with common names (e.g. "Greenville"). Applies to both primary and comparison name resolution.'),
      office: z.string().optional().describe('Office name to auto-discover comparison candidates (e.g. "Kershaw County Council"). Uses list_filers_by_office internally.'),
      active_since: z.number().optional().describe('When using office mode, only include candidates with filings since this year'),
      min_total: z.number().optional().describe('Minimum total given across all candidates to include'),
      limit: z.number().optional().describe('Max overlapping donors to return (default 50)'),
      exact_match: z.boolean().optional().describe('If true, skip name normalization and match donors by exact (case-insensitive) name. Useful when normalization causes false-positive merges.'),
    },
    async ({
      primary_candidate_filer_id,
      primary_name,
      primary_campaign_id,
      primary_office,
      comparison_candidate_filer_ids,
      comparison_names,
      county,
      office,
      active_since,
      min_total,
      limit,
      exact_match,
    }) => {
      try {
        // Resolve primary candidate by name if needed
        let primaryId = primary_candidate_filer_id
        if (!primaryId && primary_name) {
          const parts = primary_name.trim().split(/\s+/)
          const firstName = parts[0]
          const lastName = parts.slice(1).join(' ')
          if (!lastName) {
            return {
              content: [{ type: 'text' as const, text: `primary_name must include first and last name (e.g. "Steve Shaw"), got "${primary_name}".` }],
              isError: true,
            }
          }
          const resolved = await resolveByName(firstName, lastName, county)
          if ('error' in resolved) {
            return { content: [{ type: 'text' as const, text: `Could not resolve primary candidate "${primary_name}": ${resolved.error}` }], isError: true }
          }
          primaryId = resolved.candidateFilerId
        }

        if (!primaryId) {
          return {
            content: [{ type: 'text' as const, text: 'Provide primary_candidate_filer_id or primary_name.' }],
            isError: true,
          }
        }

        let comparisonIds = comparison_candidate_filer_ids || []

        // Resolve comparison candidates by name if needed
        if (comparison_names && comparison_names.length > 0 && comparisonIds.length === 0) {
          const resolved = await Promise.all(
            comparison_names.map(async name => {
              const parts = name.trim().split(/\s+/)
              const firstName = parts[0]
              const lastName = parts.slice(1).join(' ')
              if (!lastName) return { name, result: { error: `Name must include first and last name, got "${name}".` } as const }
              return { name, result: await resolveByName(firstName, lastName, county) }
            })
          )
          const failures = resolved.filter(r => 'error' in r.result)
          if (failures.length > 0) {
            const msgs = failures.map(f => `"${f.name}": ${'error' in f.result ? f.result.error : ''}`)
            return { content: [{ type: 'text' as const, text: `Could not resolve comparison candidate(s):\n${msgs.join('\n')}` }], isError: true }
          }
          comparisonIds = resolved
            .map(r => 'candidateFilerId' in r.result ? r.result.candidateFilerId : 0)
            .filter(id => id > 0)
        }

        // Office-based mode: auto-discover comparison candidates
        if (office && comparisonIds.length === 0) {
          const result = await searchFilersByOffice(office, active_since)
          const grouped = groupFilersByPerson(result.filers)
          // Exclude the primary candidate
          const others = grouped.filter(g => g.candidateFilerId !== primaryId)
          if (others.length > 25) {
            return {
              content: [{
                type: 'text' as const,
                text: `Office "${office}" has ${others.length} candidates — too many for automatic comparison (max 25). Use active_since to narrow, or pass specific comparison_candidate_filer_ids.`,
              }],
              isError: true,
            }
          }
          comparisonIds = others.map(g => g.candidateFilerId)
        }

        if (comparisonIds.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Provide comparison_candidate_filer_ids, comparison_names, or an office name to discover comparison candidates.',
            }],
            isError: true,
          }
        }

        // Fetch primary and all comparisons in parallel
        const [primaryResult, ...comparisonResults] = await Promise.all([
          fetchCandidateContributions(primaryId, primary_campaign_id, primary_office),
          ...comparisonIds.map(id => fetchCandidateContributions(id)),
        ])

        const errors: string[] = []
        if (primaryResult.error) errors.push(`Primary (${primaryId}): ${primaryResult.error}`)
        for (const comp of comparisonResults) {
          if (comp.error) errors.push(`Comparison (${comp.candidateFilerId}): ${comp.error}`)
        }

        const validComparisons = comparisonResults.filter(c => !c.error)
        if (validComparisons.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `Could not fetch any comparison candidates. Errors:\n${errors.join('\n')}`,
            }],
            isError: true,
          }
        }

        let overlap = computeOverlap(primaryResult, validComparisons, exact_match)

        if (min_total) overlap = overlap.filter(d => d.totalGiven >= min_total)

        const effectiveLimit = limit ?? 50
        const totalOverlap = overlap.length
        const limited = effectiveLimit > 0 ? overlap.slice(0, effectiveLimit) : overlap

        const candidateSummary = [
          `Primary: ${primaryResult.candidateName} — ${primaryResult.officeName} (${primaryResult.contributions.length} contributions)`,
          ...validComparisons.map(c => `Compare: ${c.candidateName} — ${c.officeName} (${c.contributions.length} contributions)`),
        ].join('\n')

        const limitNote = effectiveLimit > 0 && totalOverlap > effectiveLimit
          ? `\nShowing ${effectiveLimit} of ${totalOverlap} overlapping donors. Use limit=0 for all.`
          : ''
        const errorNote = errors.length > 0 ? `\nWarnings:\n${errors.map(e => `  - ${e}`).join('\n')}` : ''

        return {
          content: [{
            type: 'text' as const,
            text: totalOverlap === 0
              ? `${candidateSummary}\n\nNo overlapping donors found.${errorNote}`
              : `${candidateSummary}\n\n${totalOverlap} overlapping donor(s):${limitNote}${errorNote}\n---\n${JSON.stringify(limited, null, 2)}`,
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
