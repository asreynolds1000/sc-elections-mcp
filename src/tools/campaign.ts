import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  getCampaignSummary,
  getCampaignReports,
  getCampaignReportDetails,
  getContributions,
  getExpenditures,
} from '../api/ethics-client.js'

export function registerCampaignTools(server: McpServer) {
  server.tool(
    'get_campaign_summary',
    'Get campaign report summary for a candidate showing open/closed offices, balances, and contribution totals. Use candidateFilerId from search_filers.',
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
    'List all filed campaign disclosure reports for a specific campaign. Get campaignId from get_filer_profile (openOffices/closedOffices) or get_campaign_summary.',
    {
      campaign_id: z.number().describe('campaignId from profile openOffices/closedOffices'),
      candidate_filer_id: z.number().describe('candidateFilerId from search_filers'),
    },
    async ({ campaign_id, candidate_filer_id }) => {
      try {
        const reports = await getCampaignReports(campaign_id, candidate_filer_id)
        return {
          content: [{
            type: 'text' as const,
            text: reports.length === 0
              ? 'No campaign reports found'
              : JSON.stringify(reports, null, 2),
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
    'Get detailed breakdown of a single campaign report including income categories, expenditure totals, balance, and filing metadata.',
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
    'Get all contributions for a specific campaign. Returns donor names, amounts, dates, types, and election cycles.',
    {
      campaign_id: z.number().describe('campaignId from profile openOffices/closedOffices'),
      candidate_filer_id: z.number().describe('candidateFilerId from search_filers'),
    },
    async ({ campaign_id, candidate_filer_id }) => {
      try {
        const contributions = await getContributions(campaign_id, candidate_filer_id)
        return {
          content: [{
            type: 'text' as const,
            text: contributions.length === 0
              ? 'No contributions found'
              : JSON.stringify(contributions, null, 2),
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
    'Get all expenditures for a specific campaign. Returns vendor names, amounts, dates, types, and descriptions.',
    {
      campaign_id: z.number().describe('campaignId from profile openOffices/closedOffices'),
      candidate_filer_id: z.number().describe('candidateFilerId from search_filers'),
    },
    async ({ campaign_id, candidate_filer_id }) => {
      try {
        const expenditures = await getExpenditures(campaign_id, candidate_filer_id)
        return {
          content: [{
            type: 'text' as const,
            text: expenditures.length === 0
              ? 'No expenditures found'
              : JSON.stringify(expenditures, null, 2),
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
