import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getElectionYears, getElections, searchCandidates, getCandidateDetailHtml } from '../api/vrems-client.js'
import { parseCandidateDetail } from '../parsers/candidate-detail.js'

export function registerVremsTools(server: McpServer) {
  server.tool(
    'list_elections',
    'List SC elections by type and year. Returns election IDs needed for search_candidates. Three types: General (statewide primaries + general), Special, Local.',
    {
      election_type: z.enum(['General', 'Special', 'Local']).describe('Election type'),
      year: z.number().optional().describe('Specific year. Omit to get available years for this type.'),
    },
    async ({ election_type, year }) => {
      try {
        if (year) {
          const elections = await getElections(election_type, year)
          return {
            content: [{
              type: 'text' as const,
              text: elections.length === 0
                ? `No ${election_type} elections found for ${year}`
                : JSON.stringify(elections, null, 2),
            }],
          }
        } else {
          const years = await getElectionYears(election_type)
          return {
            content: [{
              type: 'text' as const,
              text: years.length === 0
                ? `No years found for ${election_type} elections`
                : `Available years for ${election_type} elections:\n${JSON.stringify(years, null, 2)}`,
            }],
          }
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
    'search_candidates',
    'Search for candidates who filed in a specific SC election. Returns rich data including contact info (phone, email), filing fee, address, and status. Get election_id from list_elections first.',
    {
      election_id: z.string().describe('Election ID from list_elections results'),
      office: z.string().optional().describe('Office filter code (-1 for all). Common: 380=State House, 379=State Senate, 469=County Council District'),
      county: z.string().optional().describe('County code (e.g. "23" for Greenville). Omit for all counties.'),
      party: z.string().optional().describe('Party filter: Republican, Democratic, Libertarian, Nonpartisan, or All'),
      status: z.string().optional().describe('Status filter: All, Active, Elected, DefeatedInPrimary, Withdrew, etc.'),
      first_name: z.string().optional().describe('Candidate first name search'),
      last_name: z.string().optional().describe('Candidate last name search'),
    },
    async ({ election_id, office, county, party, status, first_name, last_name }) => {
      try {
        const result = await searchCandidates({
          electionId: election_id,
          office,
          county,
          party,
          status,
          firstName: first_name,
          lastName: last_name,
        })

        if (result.candidates.length > 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `${result.candidates.length} candidate(s) found (rich data from CSV export):\n${JSON.stringify(result.candidates, null, 2)}`,
            }],
          }
        }

        if (result.fallback && result.fallback.length > 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `${result.fallback.length} candidate(s) found (basic data from HTML — CSV export unavailable):\n${JSON.stringify(result.fallback, null, 2)}`,
            }],
          }
        }

        return {
          content: [{ type: 'text' as const, text: 'No candidates found matching filters' }],
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
    'get_candidate_details',
    'Get detailed filing information for a specific candidate including address, filing date, status, and downloadable document links (filing form PDF, fee receipt). Use candidateId and electionId from search_candidates.',
    {
      candidate_id: z.string().describe('Candidate ID from search_candidates results'),
      election_id: z.string().describe('Election ID from list_elections or search_candidates results'),
    },
    async ({ candidate_id, election_id }) => {
      try {
        const html = await getCandidateDetailHtml(candidate_id, election_id)
        const detail = parseCandidateDetail(html)

        if (!detail.name) {
          return {
            content: [{ type: 'text' as const, text: 'Could not parse candidate detail page. The page structure may have changed.' }],
            isError: true,
          }
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(detail, null, 2) }],
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
