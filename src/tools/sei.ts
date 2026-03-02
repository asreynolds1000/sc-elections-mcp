import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getSeiDetails } from '../api/ethics-client.js'

export function registerSeiTools(server: McpServer) {
  server.tool(
    'get_sei_details',
    'Get full Statement of Economic Interest report: positions held, business interests, private and government income, family income, gifts, travel, government contracts, creditors, lobbyist contacts, regulated business associations, and property transactions. Returns the most recent report by default.',
    {
      sei_filer_id: z.number().describe('seiFilerId from search_filers results'),
      report_year: z.number().optional().describe('Specific report year. Omit for most recent.'),
    },
    async ({ sei_filer_id, report_year }) => {
      try {
        const details = await getSeiDetails(sei_filer_id, report_year)
        if (!details) {
          return {
            content: [{ type: 'text' as const, text: 'No SEI report found for this filer' }],
          }
        }

        // Build a readable summary with non-empty sections
        const sections: string[] = [
          `SEI Report for filer ${sei_filer_id} — Year: ${details.reportYear}, Submitted: ${details.dateSubmitted}`,
        ]

        if (details.positions.length > 0) {
          sections.push(`\nPositions (${details.positions.length}):`)
          sections.push(JSON.stringify(details.positions, null, 2))
        }
        if (details.businessInterests.length > 0) {
          sections.push(`\nBusiness Interests (${details.businessInterests.length}):`)
          sections.push(JSON.stringify(details.businessInterests, null, 2))
        }
        if (details.privateIncome.length > 0) {
          sections.push(`\nPrivate Income (${details.privateIncome.length}):`)
          sections.push(JSON.stringify(details.privateIncome, null, 2))
        }
        if (details.governmentIncome.length > 0) {
          sections.push(`\nGovernment Income (${details.governmentIncome.length}):`)
          sections.push(JSON.stringify(details.governmentIncome, null, 2))
        }
        if (details.familyPrivateIncome.length > 0) {
          sections.push(`\nFamily Private Income (${details.familyPrivateIncome.length}):`)
          sections.push(JSON.stringify(details.familyPrivateIncome, null, 2))
        }
        if (details.familyGovernmentIncome.length > 0) {
          sections.push(`\nFamily Government Income (${details.familyGovernmentIncome.length}):`)
          sections.push(JSON.stringify(details.familyGovernmentIncome, null, 2))
        }
        if (details.gifts.length > 0) {
          sections.push(`\nGifts (${details.gifts.length}):`)
          sections.push(JSON.stringify(details.gifts, null, 2))
        }
        if (details.travel.length > 0) {
          sections.push(`\nTravel (${details.travel.length}):`)
          sections.push(JSON.stringify(details.travel, null, 2))
        }
        if (details.governmentContracts.length > 0) {
          sections.push(`\nGovernment Contracts (${details.governmentContracts.length}):`)
          sections.push(JSON.stringify(details.governmentContracts, null, 2))
        }
        if (details.creditors.length > 0) {
          sections.push(`\nCreditors (${details.creditors.length}):`)
          sections.push(JSON.stringify(details.creditors, null, 2))
        }
        if (details.lobbyistFamily.length > 0) {
          sections.push(`\nLobbyist Family (${details.lobbyistFamily.length}):`)
          sections.push(JSON.stringify(details.lobbyistFamily, null, 2))
        }
        if (details.lobbyistPurchases.length > 0) {
          sections.push(`\nLobbyist Purchases (${details.lobbyistPurchases.length}):`)
          sections.push(JSON.stringify(details.lobbyistPurchases, null, 2))
        }
        if (details.regulatedBusinessAssociations.length > 0) {
          sections.push(`\nRegulated Business Associations (${details.regulatedBusinessAssociations.length}):`)
          sections.push(JSON.stringify(details.regulatedBusinessAssociations, null, 2))
        }
        if (details.propertyTransactions.length > 0) {
          sections.push(`\nProperty Transactions (${details.propertyTransactions.length}):`)
          sections.push(JSON.stringify(details.propertyTransactions, null, 2))
        }
        if (details.propertyImprovements.length > 0) {
          sections.push(`\nProperty Improvements (${details.propertyImprovements.length}):`)
          sections.push(JSON.stringify(details.propertyImprovements, null, 2))
        }
        if (details.propertyConflicts.length > 0) {
          sections.push(`\nProperty Conflicts (${details.propertyConflicts.length}):`)
          sections.push(JSON.stringify(details.propertyConflicts, null, 2))
        }
        if (details.additionalInformation.length > 0) {
          sections.push(`\nAdditional Information (${details.additionalInformation.length}):`)
          sections.push(JSON.stringify(details.additionalInformation, null, 2))
        }

        return {
          content: [{ type: 'text' as const, text: sections.join('\n') }],
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
