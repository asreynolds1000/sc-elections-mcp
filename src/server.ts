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
