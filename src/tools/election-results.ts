import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getEventSuggestions, searchContests, getContestGranular } from '../api/election-history-client.js'

export function registerElectionResultsTools(server: McpServer) {
  server.tool(
    'list_election_events',
    'List available SC elections from the certified results database (2008-present). Returns event IDs needed for search_election_results. Covers statewide generals, primaries, runoffs, and some municipals. Recent municipal elections may not be available yet. Known event IDs: 58=2024 General, 20=2020 General, 29=2018 General, 12=2022 General, 8=2024 R Presidential Primary.',
    {
      year: z.number().optional().describe('Filter to a specific year. Omit for all available elections.'),
    },
    async ({ year }) => {
      try {
        const result = await getEventSuggestions(year)

        if (result.events.length === 0) {
          return {
            content: [{ type: 'text' as const, text: year ? `No elections found for ${year}` : 'No elections found' }],
          }
        }

        const lines = [
          `${result.events.length} election(s) found${year ? ` for ${year}` : ''} (database covers ${result.yearRange.minYear}-${result.yearRange.maxYear}, ${result.nContests.toLocaleString()} total contests):`,
          '',
          ...result.events.map(e => `  Event ${e.id}: ${e.name} (${e.group}) — ${e.count} contests`),
        ]

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
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
    'search_election_results',
    'Search certified election results — candidates, vote totals, percentages, winner. Get event_id from list_election_events. Returns contest IDs needed for get_precinct_results. Filters by office name and division/district substring. Results are from the SC Election Commission certified database.',
    {
      event_id: z.number().describe('Election event ID from list_election_events'),
      office: z.string().optional().describe('Filter by office name substring (e.g. "State House", "President", "County Council", "State Senate"). Case-insensitive.'),
      division: z.string().optional().describe('Filter by division/district substring (e.g. "District 24", "Greenville", "Congressional District 4"). Case-insensitive.'),
      limit: z.number().optional().describe('Max results to return (default 50). The API returns up to 200 per page.'),
    },
    async ({ event_id, office, division, limit }) => {
      try {
        const effectiveLimit = limit || 50
        const result = await searchContests([event_id], { office, division, size: 200 })

        if (result.contests.length === 0) {
          const filters = [office && `office="${office}"`, division && `division="${division}"`].filter(Boolean).join(', ')
          return {
            content: [{ type: 'text' as const, text: `No contests found for event ${event_id}${filters ? ` matching ${filters}` : ''}` }],
          }
        }

        const limited = result.contests.slice(0, effectiveLimit)
        const lines: string[] = [
          `${result.totalResults} contest(s) found${limited.length < result.totalResults ? ` (showing ${limited.length})` : ''}:`,
        ]

        for (const contest of limited) {
          lines.push('')
          lines.push(`Contest ${contest.id}: ${contest.office} — ${contest.division}${contest.isSpecial ? ' (Special)' : ''}${contest.isRunoff ? ' (Runoff)' : ''}`)
          for (const c of contest.candidates) {
            const pct = (c.pctCandidateVotes * 100).toFixed(1)
            const party = c.party ? ` (${c.party})` : ''
            const winner = c.isWinner ? ' WINNER' : ''
            const writeIn = c.isWriteIn ? ' [Write-In]' : ''
            lines.push(`  ${c.displayName}${party}: ${c.nVotes.toLocaleString()} votes (${pct}%)${winner}${writeIn}`)
          }
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
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
    'get_precinct_results',
    'Get precinct-level certified vote data for a specific contest. Returns per-precinct candidate vote counts and percentages. Get contest_id from search_election_results. For statewide races (President, Governor, US Senate), you MUST specify a county — otherwise the response would include all 46 counties. Filters out failsafe/provisional precincts.',
    {
      contest_id: z.number().describe('Contest ID from search_election_results. Must be a number.'),
      county: z.string().optional().describe('Filter to a specific county (e.g. "Greenville", "Richland"). Required for statewide races. Case-insensitive substring match.'),
    },
    async ({ contest_id, county }) => {
      try {
        const result = await getContestGranular(contest_id, county)

        if (!result.contest) {
          return {
            content: [{ type: 'text' as const, text: `No contest found with ID ${contest_id}` }],
            isError: true,
          }
        }

        if (!county && result.counties.length > 10) {
          return {
            content: [{ type: 'text' as const, text: [
              `This is a statewide/multi-county contest (${result.contest.office} — ${result.contest.division}) with ${result.counties.length} counties.`,
              'Please specify a county parameter to get precinct-level results. Available counties:',
              '',
              ...result.counties.map(c => `  ${c}`),
            ].join('\n') }],
          }
        }

        if (result.precincts.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No precinct results found for contest ${contest_id}${county ? ` in "${county}"` : ''}` }],
          }
        }

        const lines: string[] = [
          `${result.contest.office} — ${result.contest.division}`,
          `${result.precincts.length} precincts${county ? ` in ${county}` : ''}:`,
          '',
        ]

        for (const p of result.precincts) {
          lines.push(`${p.precinct}:`)
          for (const c of p.candidates) {
            const pct = (c.pct * 100).toFixed(1)
            const winner = c.winner ? ' WINNER' : ''
            lines.push(`  ${c.name}: ${c.votes.toLocaleString()} (${pct}%)${winner}`)
          }
        }

        const totals: Record<string, number> = {}
        for (const p of result.precincts) {
          for (const c of p.candidates) {
            totals[c.name] = (totals[c.name] || 0) + c.votes
          }
        }
        const totalVotes = Object.values(totals).reduce((a, b) => a + b, 0)

        lines.push('')
        lines.push('TOTALS:')
        for (const [name, votes] of Object.entries(totals).sort((a, b) => b[1] - a[1])) {
          const pct = totalVotes > 0 ? ((votes / totalVotes) * 100).toFixed(1) : '0.0'
          lines.push(`  ${name}: ${votes.toLocaleString()} (${pct}%)`)
        }
        lines.push(`  Total votes: ${totalVotes.toLocaleString()}`)

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
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
