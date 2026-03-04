import { describe, it, expect } from 'vitest'
import { computeOverlap } from '../src/tools/overlap.js'
import type { CandidateContributions } from '../src/tools/overlap.js'
import type { CampaignContribution } from '../src/types.js'

function makeContribution(paidBy: string, credit: number): CampaignContribution {
  return {
    id: 1,
    date: '01/01/2024',
    report: 'Q1',
    paidBy,
    credit,
    type: 'Contribution',
    electionCycle: '2024',
    description: '',
    isRunoff: false,
    isDebtSetOff: false,
    filingDate: '01/15/2024',
  }
}

function makeCandidate(name: string, office: string, contributions: CampaignContribution[]): CandidateContributions {
  return {
    candidateFilerId: 1,
    candidateName: name,
    officeName: office,
    contributions,
  }
}

describe('computeOverlap', () => {
  it('finds overlapping donors between primary and comparison', () => {
    const primary = makeCandidate('Alice', 'Mayor', [
      makeContribution('Smith, John', 500),
      makeContribution('Doe, Jane', 250),
    ])
    const comparison = makeCandidate('Bob', 'Council', [
      makeContribution('Smith, John', 300),
      makeContribution('Unique Donor', 100),
    ])
    const result = computeOverlap(primary, [comparison])
    expect(result).toHaveLength(1)
    expect(result[0].donorName).toBe('Smith, John')
    expect(result[0].totalGiven).toBe(800)
    expect(result[0].candidateBreakdown).toHaveLength(2)
  })

  it('sorts by totalGiven descending', () => {
    const primary = makeCandidate('Alice', 'Mayor', [
      makeContribution('Small Donor', 100),
      makeContribution('Big Donor', 1000),
    ])
    const comparison = makeCandidate('Bob', 'Council', [
      makeContribution('Small Donor', 50),
      makeContribution('Big Donor', 2000),
    ])
    const result = computeOverlap(primary, [comparison])
    expect(result[0].donorName).toBe('Big Donor')
    expect(result[1].donorName).toBe('Small Donor')
  })

  it('returns empty array when no overlap', () => {
    const primary = makeCandidate('Alice', 'Mayor', [makeContribution('Donor A', 100)])
    const comparison = makeCandidate('Bob', 'Council', [makeContribution('Donor B', 200)])
    expect(computeOverlap(primary, [comparison])).toEqual([])
  })

  it('returns empty array with no comparisons', () => {
    const primary = makeCandidate('Alice', 'Mayor', [makeContribution('Donor A', 100)])
    expect(computeOverlap(primary, [])).toEqual([])
  })

  it('normalizes donor names by default (Last,First vs First Last)', () => {
    const primary = makeCandidate('Alice', 'Mayor', [makeContribution('Smith, John', 500)])
    const comparison = makeCandidate('Bob', 'Council', [makeContribution('john smith', 300)])
    const result = computeOverlap(primary, [comparison])
    expect(result).toHaveLength(1)
  })

  it('skips normalization in exact_match mode', () => {
    const primary = makeCandidate('Alice', 'Mayor', [makeContribution('Smith, John', 500)])
    const comparison = makeCandidate('Bob', 'Council', [makeContribution('john smith', 300)])
    const result = computeOverlap(primary, [comparison], true)
    // "smith, john" !== "john smith" in exact mode
    expect(result).toHaveLength(0)
  })

  it('exact_match still matches case-insensitively', () => {
    const primary = makeCandidate('Alice', 'Mayor', [makeContribution('Smith, John', 500)])
    const comparison = makeCandidate('Bob', 'Council', [makeContribution('Smith, John', 300)])
    const result = computeOverlap(primary, [comparison], true)
    expect(result).toHaveLength(1)
  })
})
