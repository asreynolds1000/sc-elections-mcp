import type { ElectionEvent, ContestResult, ContestCandidate, PrecinctResult, GranularRow } from '../types.js'

const BASE = 'https://electionhistory.scvotes.gov/api/graphql_pr'

const PSEUDO_CANDIDATE_IDS = new Set([1, 4, 6, 10])

// GraphQL query strings from SC Election Commission election history database.
// Source: https://electionhistory.scvotes.gov

const GET_EVENT_SUGGESTIONS = `query GetEventSuggestions($suggestionFilters: SearchFilters!) {
  nContests
  nCandidates
  nEvents
  yearRange { minYear maxYear }
  searchSuggestions(filters: $suggestionFilters) {
    events { id name group count }
  }
}`

const SEARCH_CONTESTS = `fragment PartyWithColor on Party { id name color }
fragment CandidateContestWithParties on CandidateInContest {
  party { ...PartyWithColor }
  party2 { ...PartyWithColor }
  party3 { ...PartyWithColor }
  party4 { ...PartyWithColor }
}
fragment CoreContest on Contest {
  id nSeats isVoterStat isHideTotalVotes isHideTotalBallots ballotsCount
  eventTypeDisplayName pctWinThreshold hasWinners isSpecial isRunoff verifiedAt
  event { id startDate isSpecial hasBallots type { id name isShowCandidatePartyLabels } }
  primaryParty { id name color }
  officeId officeModifier
  office { id name runoffType }
  division { id displayName }
  candidates {
    id ...CandidateContestWithParties voteChannelId
    candidate { id pseudocandidate showAsPercentOf displayName nickName firstName lastName slug }
    shortDisplayName displayName nVotes pctCandidateVotes
    pctRawVotes isWinner isWriteIn isMasked
  }
}
query SearchContests($pagination: Pagination!, $filters: SearchFilters!) {
  search(pagination: $pagination, filters: $filters) {
    meta { currentPage totalPages totalResults }
    results { ...CoreContest }
  }
}`

const GET_CONTEST_GRANULAR = `fragment granularDivision on Division { id name displayName divisionTypeName }
fragment PartyWithColor on Party { id name color }
fragment CandidateContestWithParties on CandidateInContest {
  party { ...PartyWithColor }
  party2 { ...PartyWithColor }
  party3 { ...PartyWithColor }
  party4 { ...PartyWithColor }
}
fragment CoreContest on Contest {
  id nSeats isVoterStat isHideTotalVotes isHideTotalBallots ballotsCount
  eventTypeDisplayName pctWinThreshold hasWinners isSpecial isRunoff verifiedAt
  event { id startDate isSpecial hasBallots type { id name isShowCandidatePartyLabels } }
  primaryParty { id name color }
  officeId officeModifier
  office { id name runoffType }
  division { id displayName }
  candidates {
    id ...CandidateContestWithParties voteChannelId
    candidate { id pseudocandidate showAsPercentOf displayName nickName firstName lastName slug }
    shortDisplayName displayName nVotes pctCandidateVotes
    pctRawVotes isWinner isWriteIn isMasked
  }
}
query GetContestGranular($contestId: Int!, $divisionFilter: Int, $voteChannelFilter: Int, $voteChannels: Boolean!, $singleVoteChannel: Int, $splitParty: Boolean!) {
  contestGranularData(
    contestId: $contestId topDivision: $divisionFilter
    voteChannels: $voteChannels singleVoteChannel: $singleVoteChannel splitParty: $splitParty
  ) {
    hasVoteChannels
    candidates {
      id voteChannelId partyId candidateId
      candidate { id showAsPercentOf pseudocandidate displayName nickName firstName lastName slug }
      shortDisplayName displayName nVotes pctCandidateVotes pctRawVotes isWinner isWriteIn isMasked
    }
    divisions {
      division { ...granularDivision }
      granularRow { candidateId partyId voteChannelId votes pct winner masked }
      children {
        division { ...granularDivision }
        granularRow { candidateId partyId voteChannelId votes pct winner masked }
        children {
          division { ...granularDivision }
          granularRow { candidateId partyId voteChannelId votes pct winner masked }
        }
      }
    }
  }
  contest(id: $contestId divisionFilter: $divisionFilter voteChannelFilter: $voteChannelFilter) {
    id isMappable officeId ...CoreContest
  }
}`

async function queryGraphQL(operationName: string, variables: Record<string, unknown>, query: string): Promise<any> {
  const response = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationName, variables, query }),
  })
  if (!response.ok) {
    throw new Error(`Election history API returned ${response.status}`)
  }
  const json = await response.json()
  if (json.errors?.length) {
    throw new Error(`GraphQL error: ${json.errors[0].message}`)
  }
  return json.data
}

const EMPTY_FILTERS = {
  ballotQuestions: { text: '', types: [], number: '', divisions: [] },
  contests: { candidates: [], offices: [], divisions: [] },
  specialElectionsOnly: false,
  voterStats: false,
  stages: [],
}

export async function getEventSuggestions(year?: number): Promise<{
  events: ElectionEvent[]
  nContests: number
  nCandidates: number
  nEvents: number
  yearRange: { minYear: number; maxYear: number }
}> {
  const global: Record<string, unknown> = { events: [] }
  if (year) {
    global.years = { from: year, to: year }
  }

  const data = await queryGraphQL('GetEventSuggestions', {
    suggestionFilters: { global, ...EMPTY_FILTERS },
  }, GET_EVENT_SUGGESTIONS)

  return {
    events: (data.searchSuggestions?.events || []).map((e: any) => ({
      id: e.id,
      name: e.name,
      group: e.group,
      count: e.count,
    })),
    nContests: data.nContests,
    nCandidates: data.nCandidates,
    nEvents: data.nEvents,
    yearRange: data.yearRange ? { minYear: data.yearRange.minYear, maxYear: data.yearRange.maxYear } : { minYear: 0, maxYear: 0 },
  }
}

export async function searchContests(
  eventIds: number[],
  options?: { office?: string; division?: string; page?: number; size?: number }
): Promise<{ contests: ContestResult[]; totalResults: number; totalPages: number }> {
  const page = options?.page || 1
  const size = options?.size || 200

  const data = await queryGraphQL('SearchContests', {
    pagination: { page, size },
    filters: { global: { events: eventIds }, ...EMPTY_FILTERS },
  }, SEARCH_CONTESTS)

  const search = data.search || {}
  let results: any[] = search.results || []

  results = results.filter((r: any) => !r.isVoterStat)

  if (options?.office) {
    const needle = options.office.toLowerCase()
    results = results.filter((r: any) => (r.office?.name || '').toLowerCase().includes(needle))
  }
  if (options?.division) {
    const needle = options.division.toLowerCase()
    results = results.filter((r: any) => (r.division?.displayName || '').toLowerCase().includes(needle))
  }

  const contests: ContestResult[] = results.map((r: any) => ({
    id: r.id,
    office: r.office?.name || '',
    division: r.division?.displayName || '',
    isSpecial: r.isSpecial || false,
    isRunoff: r.isRunoff || false,
    eventDate: r.event?.startDate || '',
    candidates: (r.candidates || [])
      .filter((c: any) => !c.candidate?.pseudocandidate && !PSEUDO_CANDIDATE_IDS.has(c.candidate?.id))
      .map((c: any): ContestCandidate => ({
        candidateId: c.candidate?.id || 0,
        displayName: c.displayName || '',
        party: c.party?.name || null,
        nVotes: c.nVotes || 0,
        pctCandidateVotes: c.pctCandidateVotes || 0,
        isWinner: c.isWinner || false,
        isWriteIn: c.isWriteIn || false,
      })),
  }))

  return {
    contests,
    totalResults: search.meta?.totalResults || contests.length,
    totalPages: search.meta?.totalPages || 1,
  }
}

export async function getContestGranular(
  contestId: number,
  county?: string
): Promise<{
  contest: { id: number; office: string; division: string } | null
  candidates: { candidateId: number; displayName: string; party: string | null }[]
  precincts: PrecinctResult[]
  counties: string[]
}> {
  const data = await queryGraphQL('GetContestGranular', {
    contestId,
    divisionFilter: null,
    splitParty: false,
    voteChannels: false,
    singleVoteChannel: null,
  }, GET_CONTEST_GRANULAR)

  const granular = data.contestGranularData || {}
  const contestInfo = data.contest

  const candidateMap = new Map<number, { displayName: string; party: string | null }>()
  for (const c of granular.candidates || []) {
    if (c.candidate?.pseudocandidate || PSEUDO_CANDIDATE_IDS.has(c.candidateId)) continue
    candidateMap.set(c.candidateId, {
      displayName: c.displayName || '',
      party: null,
    })
  }

  const divisions = granular.divisions || {}
  const topChildren: any[] = divisions.children || []

  const allCounties: string[] = topChildren.map((c: any) => c.division?.displayName || '').filter(Boolean)

  let filteredCounties = topChildren
  if (county) {
    const needle = county.toLowerCase()
    filteredCounties = topChildren.filter((c: any) =>
      (c.division?.displayName || '').toLowerCase().includes(needle)
    )
  }

  const precincts: PrecinctResult[] = []
  for (const countyDiv of filteredCounties) {
    for (const precinctDiv of countyDiv.children || []) {
      const rawName: string = precinctDiv.division?.displayName || ''
      const name = rawName.replace(/^Precinct\s+/i, '')
      if (name.toLowerCase().includes('failsafe') || name.toLowerCase().includes('provisional')) continue

      const rows: GranularRow[] = precinctDiv.granularRow || []
      const candidates: PrecinctResult['candidates'] = []
      for (const row of rows) {
        if (PSEUDO_CANDIDATE_IDS.has(row.candidateId)) continue
        const cand = candidateMap.get(row.candidateId)
        if (!cand) continue
        candidates.push({
          name: cand.displayName,
          votes: row.votes,
          pct: row.pct,
          winner: row.winner,
        })
      }
      if (candidates.length > 0) {
        precincts.push({ precinct: name, candidates })
      }
    }
  }

  return {
    contest: contestInfo ? {
      id: contestInfo.id,
      office: contestInfo.office?.name || '',
      division: contestInfo.division?.displayName || '',
    } : null,
    candidates: Array.from(candidateMap.entries()).map(([id, c]) => ({
      candidateId: id,
      displayName: c.displayName,
      party: c.party,
    })),
    precincts,
    counties: allCounties,
  }
}
