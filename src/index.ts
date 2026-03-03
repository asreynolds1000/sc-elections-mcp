#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerSearchTools } from './tools/search.js'
import { registerCampaignTools } from './tools/campaign.js'
import { registerCrossSearchTools } from './tools/cross-search.js'
import { registerSeiTools } from './tools/sei.js'
import { registerVremsTools } from './tools/vrems.js'

const server = new McpServer({
  name: 'sc-elections-mcp',
  version: '0.4.0',
})

// Ethics Commission tools (ethicsfiling.sc.gov)
registerSearchTools(server)
registerCampaignTools(server)
registerCrossSearchTools(server)
registerSeiTools(server)

// SC Votes / VREMS tools (vrems.scvotes.sc.gov)
registerVremsTools(server)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
