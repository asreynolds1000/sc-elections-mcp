import { describe, it, expect, afterAll } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { registerSearchTools } from '../src/tools/search.js'
import { registerCampaignTools } from '../src/tools/campaign.js'
import { registerCrossSearchTools } from '../src/tools/cross-search.js'
import { registerOverlapTools } from '../src/tools/overlap.js'
import { registerSeiTools } from '../src/tools/sei.js'
import { registerVremsTools } from '../src/tools/vrems.js'
import { registerCrossReferenceTools } from '../src/tools/cross-reference.js'

const EXPECTED_TOOLS = [
  // Search & Lookup (Ethics)
  'search_filers',
  'list_filers_by_office',
  'list_filers_by_county',
  'get_filer_profile',
  'list_office_names',
  // Campaign Finance (Ethics)
  'get_campaign_summary',
  'get_campaign_reports',
  'get_campaign_report_details',
  'get_contributions',
  'get_expenditures',
  // Cross-Candidate Search (Ethics)
  'search_expenditures',
  'search_contributions',
  // Donor Analysis (Ethics)
  'find_donor_overlap',
  // SEI (Ethics)
  'get_sei_details',
  // Candidate Filings (VREMS)
  'list_elections',
  'search_candidates',
  'get_candidate_details',
  // Cross-System (Ethics + VREMS)
  'find_expected_filers',
] as const

describe('MCP server smoke test', () => {
  const server = new McpServer({
    name: 'sc-elections-mcp',
    version: '0.5.0',
  })

  registerSearchTools(server)
  registerCampaignTools(server)
  registerCrossSearchTools(server)
  registerOverlapTools(server)
  registerSeiTools(server)
  registerVremsTools(server)
  registerCrossReferenceTools(server)

  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  afterAll(async () => {
    await client.close()
    await server.close()
  })

  it('registers exactly 18 tools', async () => {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    const { tools } = await client.listTools()
    const toolNames = tools.map((t) => t.name).sort()

    expect(tools).toHaveLength(18)
    expect(toolNames).toEqual([...EXPECTED_TOOLS].sort())
  })
})
