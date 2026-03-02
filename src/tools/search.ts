import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { searchFilers, getFilerProfile } from '../api/ethics-client.js'

export function registerSearchTools(server: McpServer) {
  server.tool(
    'search_filers',
    'Search SC Ethics Commission for candidates and officials by name. Returns candidateFilerId and seiFilerId needed for other tools. Supports partial name matching.',
    {
      name: z.string().describe('Name to search for (e.g. "mcmaster", "haley")'),
    },
    async ({ name }) => {
      try {
        const results = await searchFilers(name)
        return {
          content: [{
            type: 'text' as const,
            text: results.length === 0
              ? `No filers found matching "${name}"`
              : JSON.stringify(results, null, 2),
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
    'get_filer_profile',
    'Get full profile for a filer including address, phone, positions held, and open/closed campaign offices. Use candidateFilerId and seiFilerId from search_filers.',
    {
      candidate_filer_id: z.number().describe('candidateFilerId from search_filers results'),
      sei_filer_id: z.number().describe('seiFilerId from search_filers results'),
    },
    async ({ candidate_filer_id, sei_filer_id }) => {
      try {
        const profile = await getFilerProfile(candidate_filer_id, sei_filer_id)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(profile, null, 2) }],
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
