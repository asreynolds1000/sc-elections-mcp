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
      'Each campaign entry has its own filerId and campaignId, which can differ across offices and cycles. Use get_campaign_summary to check the open and closed campaigns and pass the explicit campaign_id for the office and cycle you want.',
      'An empty result from get_campaign_reports, get_contributions, or get_expenditures can also mean the Ethics API returned an error. The client converts non-success HTTP responses into empty lists. Repeat the call and verify the selected campaign before concluding there are no filings or matching transactions.',
      'Statewide contribution and expenditure lists can truncate at 60,000 characters even with limit=0. Query one year at a time and check each response for truncation. For campaign-level records, use get_contributions or get_expenditures with limit=0 to get all matching records returned by SC Ethics.',
      'Statewide summary=true results omit dates. Campaign-level transaction summaries can include a dateRange, but use full records to verify transaction dates.',
      'Check the office on each statewide record because office labels vary across endpoints. search_contributions requires a filter besides office because the upstream office filter is unreliable. For search_contributions with summary=true, omit office. Contribution summary totals cover every row returned by the Ethics API, without applying an office filter to those rows. Do not use a contribution summary total as the total for one office. Use full records and verify each row for office-specific analysis.',
      'Filer office searches can match historical offices, so verify the campaign or office in the filer profile. The office and county listings attempt campaign enrichment for up to 50 filers when recent_only or active_only is enabled. Campaign fields may be missing when a lookup is skipped, fails, or finds no matching campaign. Use get_campaign_summary to verify missing campaign details. active_only drops filers whose open status could not be confirmed.',
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
