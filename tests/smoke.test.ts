import { describe, it, expect, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/server.js'

// Built from createMcpServer() rather than a parallel list of register calls.
// The old version maintained its own registration list, drifted when
// election-results tools were added, and nothing caught it because this file
// was excluded from the vitest include glob.
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
  'search_campaign_reports',
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
  // Certified results
  'list_election_events',
  'search_election_results',
  'get_precinct_results',
] as const

describe('MCP server smoke test', () => {
  const server = createMcpServer()
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  afterAll(async () => {
    await client.close()
    await server.close()
  })

  it('registers every tool the server factory wires up', async () => {
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ])

    const { tools } = await client.listTools()
    const toolNames = tools.map((t) => t.name).sort()

    expect(toolNames).toEqual([...EXPECTED_TOOLS].sort())
    expect(tools).toHaveLength(EXPECTED_TOOLS.length)
  })
})
