import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { searchExpenditures, searchContributions } from '../api/ethics-client.js'

export function registerCrossSearchTools(server: McpServer) {
  server.tool(
    'search_expenditures',
    'Search expenditures across ALL candidates statewide. Find who is paying a vendor, what a candidate is spending on, or expenditures by office/year. At least one filter should be provided.',
    {
      candidate: z.string().optional().describe('Candidate name filter (partial match)'),
      office: z.string().optional().describe('Office name filter (partial match)'),
      vendor_name: z.string().optional().describe('Vendor/payee name filter (partial match)'),
      year: z.number().optional().describe('Election year filter (e.g. 2024). Omit for all years.'),
      amount: z.number().optional().describe('Minimum amount filter'),
      description: z.string().optional().describe('Expenditure description filter'),
    },
    async ({ candidate, office, vendor_name, year, amount, description }) => {
      try {
        const results = await searchExpenditures({
          candidate,
          office,
          vendorName: vendor_name,
          expenditureYear: year,
          amount,
          expDesc: description,
        })
        return {
          content: [{
            type: 'text' as const,
            text: results.length === 0
              ? 'No expenditures found matching filters'
              : `${results.length} expenditure(s) found:\n${JSON.stringify(results, null, 2)}`,
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
    'Search contributions across ALL candidates statewide. Find who is donating to whom, contributions by office/year, or donors by name. At least one filter should be provided.',
    {
      candidate: z.string().optional().describe('Candidate name filter (partial match)'),
      office: z.string().optional().describe('Office name filter (partial match)'),
      contributor_name: z.string().optional().describe('Contributor/donor name filter (partial match)'),
      year: z.number().optional().describe('Election year filter (e.g. 2024). Omit for all years.'),
      amount: z.number().optional().describe('Minimum amount filter'),
    },
    async ({ candidate, office, contributor_name, year, amount }) => {
      try {
        const results = await searchContributions({
          candidate,
          office,
          contributorName: contributor_name,
          contributionYear: year,
          amount,
        })
        return {
          content: [{
            type: 'text' as const,
            text: results.length === 0
              ? 'No contributions found matching filters'
              : `${results.length} contribution(s) found:\n${JSON.stringify(results, null, 2)}`,
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
