import { describe, it, expect } from 'vitest'
import { isRealChoice, getContestGranular } from './election-history-client.js'

/* Regression tests for the two bugs that made the certified 2024 Greenville County
   penny-tax referendum (contest 7322) look like it had no precinct data for weeks.

   Both bugs returned an EMPTY result rather than an error, which is indistinguishable
   from "this contest publishes nothing." Keep these tests: the failure mode is silent. */

describe('isRealChoice — ballot-question options are not pseudo-candidates', () => {
  it('KEEPS ballot-question Yes/No (the bug: pseudocandidate is a string tag, not a boolean)', () => {
    expect(isRealChoice({ candidateId: 7, candidate: { id: '7', pseudocandidate: 'BQ_YES' } })).toBe(true)
    expect(isRealChoice({ candidateId: 8, candidate: { id: '8', pseudocandidate: 'BQ_NO' } })).toBe(true)
  })

  it('keeps ordinary candidates, which carry no tag', () => {
    expect(isRealChoice({ candidateId: 4242, candidate: { id: '4242', pseudocandidate: null } })).toBe(true)
    expect(isRealChoice({ candidateId: 4242, candidate: { id: '4242' } })).toBe(true)
  })

  it('still drops non-ballot-question pseudo-candidates', () => {
    expect(isRealChoice({ candidateId: 99, candidate: { id: '99', pseudocandidate: 'WRITE_IN' } })).toBe(false)
    expect(isRealChoice({ candidateId: 99, candidate: { id: '99', pseudocandidate: 'UNDERVOTE' } })).toBe(false)
  })

  it('drops the known pseudo ids whether the api sends them as string or number', () => {
    // The api returns candidate.id as a string but candidateId as a number. An
    // uncoerced Set<number>.has() silently never matched the string side.
    for (const id of [1, 4, 6, 10]) {
      expect(isRealChoice({ candidateId: id, candidate: { id: String(id) } })).toBe(false)
      expect(isRealChoice({ candidateId: id, candidate: { id } })).toBe(false)
    }
  })
})

/* Live-API checks. Opt in with SC_ELECTIONS_LIVE=1 so the default suite stays offline
   and deterministic. Run these after touching division-shape or candidate-filter logic. */
const live = process.env.SC_ELECTIONS_LIVE === '1' ? describe : describe.skip

live('getContestGranular — both division shapes (live)', () => {
  /* The api returns two shapes and does not tell you which you got:
       statewide      -> county -> precinct   (top-level children are counties)
       county-level   -> precinct             (top-level children ARE the precincts)
     Assuming the nested shape returned zero precincts on every county-level contest.

     NOTE: a positive control MUST match the shape under test. This repo previously
     validated the referendum query using a DISTRICT contest, which takes the nested
     branch — so the control passed while the real call failed. */

  it('returns precincts for a county-level BALLOT QUESTION (contest 7322)', async () => {
    const r = await getContestGranular(7322, 'Greenville')
    expect(r.precincts.length).toBe(151)

    const totals: Record<string, number> = {}
    for (const p of r.precincts) for (const c of p.candidates) totals[c.name] = (totals[c.name] || 0) + c.votes

    // Certified countywide is 119,611 / 126,834. The 3 failsafe/provisional units
    // (546 Yes / 530 No) are filtered out here by design, so the regular-precinct
    // totals must reconcile to certified minus exactly those.
    expect(totals.Yes).toBe(119_611 - 546)
    expect(totals.No).toBe(126_834 - 530)
  }, 30_000)

  it('returns precincts for a county-level CANDIDATE race (contest 7559)', async () => {
    const r = await getContestGranular(7559, 'Greenville')
    expect(r.precincts.length).toBe(151)
  }, 30_000)

  it('still returns precincts for a nested/district contest (contest 7809)', async () => {
    const r = await getContestGranular(7809, 'Greenville')
    expect(r.precincts.length).toBe(17)
  }, 30_000)

  it('does not filter county-level precincts by precinct NAME', async () => {
    // In the flat shape a `county` argument must not be used as a name filter:
    // 111 of Greenville's 151 precincts do not contain "Greenville" in their name.
    const r = await getContestGranular(7322, 'Greenville')
    const named = r.precincts.filter(p => p.precinct.toLowerCase().includes('greenville'))
    expect(named.length).toBeLessThan(r.precincts.length)
    expect(r.precincts.length).toBe(151)
  }, 30_000)
})
