import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  getCampaignSummary,
  getCampaignReportDetails,
  cachedGetCampaignSummary,
  resolveCampaignContext,
  resolveCandidateName,
  getContributions,
  getExpenditures,
  getCampaignReports,
  buildContributionSummary,
  buildExpenditureSummary,
} from '../api/ethics-client.js'
import type { CampaignContext } from '../types.js'

function formatHeader(context: CampaignContext, count: number, totalLabel: string, totalAmount: number): string {
  return `Campaign: ${context.candidateName} — ${context.officeName} (campaignId: ${context.campaignId}, candidateFilerId: ${context.candidateFilerId}, status: ${context.campaignStatus})\n${count} ${totalLabel} totaling $${totalAmount.toFixed(2)}\n---`
}

export function registerCampaignTools(server: McpServer) {
  server.tool(
    'get_campaign_summary',
    'Get campaign report summary for a candidate showing open/closed offices, balances, and contribution totals. Use candidateFilerId from search_filers. Each office entry includes initialReportFiledDate (when the candidate first filed — use this to find new candidates entering races), balance, and total contributions. Note: an open campaign does not necessarily mean the person currently holds that office. A candidate may have different filerIds for different offices — the contribution/expenditure tools handle this automatically.',
    {
      candidate_filer_id: z.number().describe('candidateFilerId from search_filers results'),
    },
    async ({ candidate_filer_id }) => {
      try {
        const summary = await getCampaignSummary(candidate_filer_id)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
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
    'get_campaign_reports',
    'List filed campaign disclosure reports. campaign_id is optional — auto-resolved for single-campaign candidates, or use office hint to disambiguate (e.g. office="County Council").',
    {
      candidate_filer_id: z.number().describe('candidateFilerId from search_filers results'),
      campaign_id: z.number().optional().describe('campaignId — optional, auto-resolved if candidate has one campaign'),
      office: z.string().optional().describe('Office hint to disambiguate when multiple campaigns exist (e.g. "County Council", "Governor")'),
    },
    async ({ candidate_filer_id, campaign_id, office }) => {
      try {
        const summary = await cachedGetCampaignSummary(candidate_filer_id)
        const resolved = resolveCampaignContext(summary, candidate_filer_id, campaign_id, office)
        if ('error' in resolved) {
          return { content: [{ type: 'text' as const, text: resolved.error }], isError: true }
        }

        const reports = await getCampaignReports(resolved.resolvedCampaignId, candidate_filer_id)
        const header = `Campaign: ${resolved.context.candidateName} — ${resolved.context.officeName} (campaignId: ${resolved.context.campaignId}, status: ${resolved.context.campaignStatus})`

        return {
          content: [{
            type: 'text' as const,
            text: reports.length === 0
              ? `${header}\nNo campaign reports found`
              : `${header}\n${reports.length} report(s)\n---\n${JSON.stringify(reports, null, 2)}`,
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
    'get_campaign_report_details',
    'Get detailed breakdown of a single campaign report including income categories, expenditure totals, balance, and filing metadata. Use report_id from get_campaign_reports results.',
    {
      report_id: z.number().describe('Report ID from get_campaign_reports'),
    },
    async ({ report_id }) => {
      try {
        const details = await getCampaignReportDetails(report_id)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(details, null, 2) }],
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
    'get_contributions',
    'Get contributions for a candidate\'s campaign. Returns donor names, amounts, dates, types. Every response includes a metadata header identifying the candidate/office for verification.\n\ncampaign_id is optional: omit it for single-campaign candidates (auto-resolved). Provide it when a candidate has multiple campaigns, or use the office hint to disambiguate (e.g. office="County Council").\n\nUse summary=true for high-volume candidates — returns top 20 donors, totals by type, date range. Use year/min_amount to filter. Default limit is 200 records; pass limit=0 for all.',
    {
      candidate_filer_id: z.number().describe('candidateFilerId from search_filers results'),
      campaign_id: z.number().optional().describe('campaignId — optional, auto-resolved if candidate has one campaign'),
      office: z.string().optional().describe('Office hint to disambiguate when multiple campaigns exist (e.g. "County Council", "Governor")'),
      summary: z.boolean().optional().describe('If true, return aggregated top-20 view instead of full records'),
      year: z.number().optional().describe('Filter to contributions in this year only'),
      min_amount: z.number().optional().describe('Filter to contributions >= this amount'),
      limit: z.number().optional().describe('Max records to return (default 200, 0 for all)'),
    },
    async ({ candidate_filer_id, campaign_id, office, summary: wantSummary, year, min_amount, limit }) => {
      try {
        const campaignSummary = await cachedGetCampaignSummary(candidate_filer_id)

        // Resolve candidate name when summary.name is null
        let candidateNameOverride: string | undefined
        if (!campaignSummary.name) {
          candidateNameOverride = await resolveCandidateName(candidate_filer_id)
        }

        const resolved = resolveCampaignContext(campaignSummary, candidate_filer_id, campaign_id, office, candidateNameOverride)
        if ('error' in resolved) {
          return { content: [{ type: 'text' as const, text: resolved.error }], isError: true }
        }

        let contributions = await getContributions(resolved.resolvedCampaignId, resolved.resolvedFilerId)

        // Client-side filters
        if (year) {
          contributions = contributions.filter(c => {
            if (!c.date) return false
            return new Date(c.date).getFullYear() === year
          })
        }
        if (min_amount) {
          contributions = contributions.filter(c => c.credit >= min_amount)
        }

        if (wantSummary) {
          const result = buildContributionSummary(contributions, resolved.context)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        }

        // Full records with limit
        const totalCount = contributions.length
        const totalAmount = contributions.reduce((sum, c) => sum + c.credit, 0)
        const effectiveLimit = limit === undefined ? 200 : limit
        const limited = effectiveLimit > 0 ? contributions.slice(0, effectiveLimit) : contributions

        const header = formatHeader(resolved.context, totalCount, 'contributions', totalAmount)
        const limitNote = effectiveLimit > 0 && totalCount > effectiveLimit
          ? `\nShowing ${effectiveLimit} of ${totalCount}. Use limit=0 for all, or summary=true for aggregated view.`
          : ''

        return {
          content: [{
            type: 'text' as const,
            text: totalCount === 0
              ? `${header}\nNo contributions found`
              : `${header}${limitNote}\n${JSON.stringify(limited, null, 2)}`,
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
    'get_expenditures',
    'Get expenditures for a candidate\'s campaign. Returns vendor names, amounts, dates, types. Every response includes a metadata header identifying the candidate/office for verification.\n\ncampaign_id is optional: omit it for single-campaign candidates (auto-resolved). Provide it when a candidate has multiple campaigns, or use the office hint to disambiguate (e.g. office="County Council").\n\nUse summary=true for high-volume candidates — returns top 20 vendors, totals by type, date range. Use year/min_amount to filter. Default limit is 200 records; pass limit=0 for all.',
    {
      candidate_filer_id: z.number().describe('candidateFilerId from search_filers results'),
      campaign_id: z.number().optional().describe('campaignId — optional, auto-resolved if candidate has one campaign'),
      office: z.string().optional().describe('Office hint to disambiguate when multiple campaigns exist (e.g. "County Council", "Governor")'),
      summary: z.boolean().optional().describe('If true, return aggregated top-20 view instead of full records'),
      year: z.number().optional().describe('Filter to expenditures in this year only'),
      min_amount: z.number().optional().describe('Filter to expenditures >= this amount'),
      limit: z.number().optional().describe('Max records to return (default 200, 0 for all)'),
    },
    async ({ candidate_filer_id, campaign_id, office, summary: wantSummary, year, min_amount, limit }) => {
      try {
        const campaignSummary = await cachedGetCampaignSummary(candidate_filer_id)

        // Resolve candidate name when summary.name is null
        let candidateNameOverride: string | undefined
        if (!campaignSummary.name) {
          candidateNameOverride = await resolveCandidateName(candidate_filer_id)
        }

        const resolved = resolveCampaignContext(campaignSummary, candidate_filer_id, campaign_id, office, candidateNameOverride)
        if ('error' in resolved) {
          return { content: [{ type: 'text' as const, text: resolved.error }], isError: true }
        }

        let expenditures = await getExpenditures(resolved.resolvedCampaignId, resolved.resolvedFilerId)

        // Client-side filters
        if (year) {
          expenditures = expenditures.filter(e => {
            if (!e.date) return false
            return new Date(e.date).getFullYear() === year
          })
        }
        if (min_amount) {
          expenditures = expenditures.filter(e => e.debit >= min_amount)
        }

        if (wantSummary) {
          const result = buildExpenditureSummary(expenditures, resolved.context)
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
        }

        // Full records with limit
        const totalCount = expenditures.length
        const totalAmount = expenditures.reduce((sum, e) => sum + e.debit, 0)
        const effectiveLimit = limit === undefined ? 200 : limit
        const limited = effectiveLimit > 0 ? expenditures.slice(0, effectiveLimit) : expenditures

        const header = formatHeader(resolved.context, totalCount, 'expenditures', totalAmount)
        const limitNote = effectiveLimit > 0 && totalCount > effectiveLimit
          ? `\nShowing ${effectiveLimit} of ${totalCount}. Use limit=0 for all, or summary=true for aggregated view.`
          : ''

        return {
          content: [{
            type: 'text' as const,
            text: totalCount === 0
              ? `${header}\nNo expenditures found`
              : `${header}${limitNote}\n${JSON.stringify(limited, null, 2)}`,
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
