import { describe, it, expect } from 'vitest'
import { summarizeCrossSearchContributions, summarizeCrossSearchExpenditures } from '../src/tools/cross-search.js'
import type { CrossSearchContribution, CrossSearchExpenditure } from '../src/types.js'

function makeContribution(overrides: Partial<CrossSearchContribution> = {}): CrossSearchContribution {
  return {
    contributionId: 1,
    officeRunId: 10,
    candidateId: 100,
    date: '01/01/2024',
    amount: 500,
    candidateName: 'Smith, John',
    officeName: 'Mayor',
    electionDate: '11/05/2024',
    contributorName: 'Donor A',
    contributorOccupation: '',
    group: '',
    contributorAddress: '',
    description: null,
    ...overrides,
  }
}

function makeExpenditure(overrides: Partial<CrossSearchExpenditure> = {}): CrossSearchExpenditure {
  return {
    candidateFilerId: 100,
    credentialId: 1,
    campaignId: 10,
    office: 'Mayor',
    candidateName: 'Smith, John',
    expDate: '01/01/2024',
    expId: 1,
    vendorName: 'Acme Printing',
    amount: 1000,
    address: '123 Main St',
    expDesc: 'Flyers',
    ...overrides,
  }
}

describe('summarizeCrossSearchContributions', () => {
  it('aggregates by candidate', () => {
    const results = [
      makeContribution({ candidateId: 1, officeRunId: 10, amount: 500, candidateName: 'Alice' }),
      makeContribution({ candidateId: 1, officeRunId: 10, amount: 300, candidateName: 'Alice' }),
      makeContribution({ candidateId: 2, officeRunId: 20, amount: 100, candidateName: 'Bob' }),
    ]
    const summary = summarizeCrossSearchContributions(results)
    expect(summary.totalRecords).toBe(3)
    expect(summary.grandTotal).toBe(900)
    expect(summary.byCandidateTop20).toHaveLength(2)
    expect(summary.byCandidateTop20[0].candidateName).toBe('Alice')
    expect(summary.byCandidateTop20[0].totalAmount).toBe(800)
  })

  it('limits to top 20', () => {
    const results = Array.from({ length: 25 }, (_, i) =>
      makeContribution({ candidateId: i, officeRunId: i, amount: 100, candidateName: `Candidate ${i}` })
    )
    const summary = summarizeCrossSearchContributions(results)
    expect(summary.byCandidateTop20).toHaveLength(20)
  })
})

describe('summarizeCrossSearchExpenditures', () => {
  it('aggregates by vendor', () => {
    const results = [
      makeExpenditure({ vendorName: 'Acme Printing', amount: 1000, candidateName: 'Alice' }),
      makeExpenditure({ vendorName: 'acme printing', amount: 500, candidateName: 'Bob' }),
      makeExpenditure({ vendorName: 'Other Co', amount: 200, candidateName: 'Alice' }),
    ]
    const summary = summarizeCrossSearchExpenditures(results)
    expect(summary.totalRecords).toBe(3)
    expect(summary.grandTotal).toBe(1700)
    expect(summary.byVendorTop20[0].vendorName).toBe('Acme Printing')
    expect(summary.byVendorTop20[0].totalAmount).toBe(1500)
    expect(summary.byVendorTop20[0].candidateCount).toBe(2)
  })

  it('limits to top 20', () => {
    const results = Array.from({ length: 25 }, (_, i) =>
      makeExpenditure({ vendorName: `Vendor ${i}`, amount: 100 })
    )
    const summary = summarizeCrossSearchExpenditures(results)
    expect(summary.byVendorTop20).toHaveLength(20)
  })
})
