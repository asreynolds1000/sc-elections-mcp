import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { cachedGetCampaignSummary, resolveCampaignContext, resolveCandidateName, getContributions, searchFilersByOffice, groupFilersByPerson } from '../api/ethics-client.js'
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
    const contributions = await getContributions(resolved.resolvedCampaignId, candidateFilerId)
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
    'Find donors who contributed to multiple candidates. Two modes:\n1. Explicit: pass primary + comparison candidate IDs (up to 20)\n2. Office-based: pass primary + office name to auto-discover comparison candidates (max 25)\nFetches contributions in parallel and computes intersection. Name matching normalizes "Last, First" vs "First Last", strips suffixes (Jr, Sr, etc), and is case-insensitive.',
    {
      primary_candidate_filer_id: z.number().describe('candidateFilerId of the primary candidate'),
      primary_campaign_id: z.number().optional().describe('campaignId for primary — optional, auto-resolved'),
      primary_office: z.string().optional().describe('Office hint for primary candidate'),
      comparison_candidate_filer_ids: z.array(z.number()).max(20).optional().describe('Array of up to 20 candidateFilerId values to compare against. Omit if using office param.'),
      office: z.string().optional().describe('Office name to auto-discover comparison candidates (e.g. "Kershaw County Council"). Uses list_filers_by_office internally.'),
      active_since: z.number().optional().describe('When using office mode, only include candidates with filings since this year'),
      min_total: z.number().optional().describe('Minimum total given across all candidates to include'),
      limit: z.number().optional().describe('Max overlapping donors to return (default 50)'),
      exact_match: z.boolean().optional().describe('If true, skip name normalization and match donors by exact (case-insensitive) name. Useful when normalization causes false-positive merges.'),
    },
    async ({
      primary_candidate_filer_id,
      primary_campaign_id,
      primary_office,
      comparison_candidate_filer_ids,
      office,
      active_since,
      min_total,
      limit,
      exact_match,
    }) => {
      try {
        let comparisonIds = comparison_candidate_filer_ids || []

        // Office-based mode: auto-discover comparison candidates
        if (office && comparisonIds.length === 0) {
          const result = await searchFilersByOffice(office, active_since)
          const grouped = groupFilersByPerson(result.filers)
          // Exclude the primary candidate
          const others = grouped.filter(g => g.candidateFilerId !== primary_candidate_filer_id)
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
              text: 'Provide either comparison_candidate_filer_ids or an office name to discover comparison candidates.',
            }],
            isError: true,
          }
        }

        // Fetch primary and all comparisons in parallel
        const [primaryResult, ...comparisonResults] = await Promise.all([
          fetchCandidateContributions(primary_candidate_filer_id, primary_campaign_id, primary_office),
          ...comparisonIds.map(id => fetchCandidateContributions(id)),
        ])

        const errors: string[] = []
        if (primaryResult.error) errors.push(`Primary (${primary_candidate_filer_id}): ${primaryResult.error}`)
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
