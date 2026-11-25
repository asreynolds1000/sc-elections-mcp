import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerSearchTools } from './tools/search.js'
import { registerCampaignTools } from './tools/campaign.js'
import { registerCrossSearchTools } from './tools/cross-search.js'
import { registerSeiTools } from './tools/sei.js'
import { registerVremsTools } from './tools/vrems.js'
import { registerOverlapTools } from './tools/overlap.js'
import { registerCrossReferenceTools } from './tools/cross-reference.js'
import { registerElectionResultsTools } from './tools/election-results.js'

/** Create one fully registered server for either transport. */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'sc-elections-mcp',
    version: '0.9.0',
  }, {
    instructions: [
      'Start search_filers with the exact last name and confirm the filer in the results, which can include partial matches. Use the candidateFilerId and seiFilerId from that search for candidate and SEI lookups.',
      'Each campaign entry has its own filerId and campaignId, which can differ across offices and cycles. If a campaign lookup is empty, search by last name again and use get_campaign_summary to check the open and closed campaigns. Pass the explicit campaign_id for the office and cycle you want.',
      'Statewide contribution and expenditure lists can truncate at 60,000 characters even with limit=0. Query one year at a time and check each response for truncation. For campaign-level records, use get_contributions or get_expenditures with limit=0 to get all matching records returned by SC Ethics.',
      'Statewide summary=true results omit dates. Campaign-level transaction summaries can include a dateRange, but use full records to verify transaction dates.',
      'Check the office on each statewide result because office labels vary across endpoints. search_contributions requires a filter besides office because the upstream office filter is unreliable. Filer office searches can match historical offices, so verify the campaign or office in the filer profile.',
    ].join('\n\n'),
  })

  // Ethics Commission tools (ethicsfiling.sc.gov)
  registerSearchTools(server)
  registerCampaignTools(server)
  registerCrossSearchTools(server)
  registerOverlapTools(server)
  registerSeiTools(server)

  // SC Votes / VREMS tools (vrems.scvotes.sc.gov)
  registerVremsTools(server)

  // Cross-system tools (Ethics + VREMS)
  registerCrossReferenceTools(server)

  // SC Election History tools (electionhistory.scvotes.gov)
  registerElectionResultsTools(server)

  return server
}
