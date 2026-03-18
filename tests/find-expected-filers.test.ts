import { describe, it, expect } from 'vitest'
import { normalizeEthicsName, normalizeVremsName, diffEthicsVrems } from '../src/tools/cross-reference.js'
import type { GroupedFiler, VremsCandidate } from '../src/types.js'

function makeGroupedFiler(candidate: string, officeName = 'County Council', campaignStatus: 'open' | 'closed' = 'open'): GroupedFiler {
  return {
    candidate,
    address: '123 Main St',
    universalUserId: 1,
    candidateFilerId: 100,
    seiFilerId: 200,
    lastSubmission: '01/01/2024',
    offices: [{ officeName, officeId: 1, lastSubmission: '01/01/2024' }],
    primaryOfficeName: officeName,
    campaignStatus,
    balance: 1000,
    campaignId: 42,
  }
}

function makeVremsCandidate(firstName: string, lastName: string, office = 'County Council'): VremsCandidate {
  return {
    ballotSortOrder: '',
    filingLevel: '',
    electionName: '',
    office,
    district: '',
    counties: '',
    ballotFirstMiddle: firstName,
    ballotLastSuffix: lastName,
    runningMate: '',
    firstName,
    middleName: '',
    lastName,
    suffix: '',
    party: 'Republican',
    filingLocation: 'Greenville',
    dateFiled: '3/18/2026',
    timeFiled: '',
    filingFee: '',
    status: 'Active',
    statusDate: '',
    address: '',
    phone: '',
    email: '',
    runningMateOffice: '',
  }
}

describe('normalizeEthicsName', () => {
  it('handles standard Last, First format', () => {
    expect(normalizeEthicsName('Smith, John')).toBe('smith|john')
  })

  it('drops middle name — only uses first word of first-name token', () => {
    expect(normalizeEthicsName('Smith, John Alan')).toBe('smith|john')
  })

  it('strips Jr suffix from last name', () => {
    expect(normalizeEthicsName('Smith Jr, John')).toBe('smith|john')
    expect(normalizeEthicsName('Smith Jr., John')).toBe('smith|john')
  })

  it('strips Sr suffix from last name', () => {
    expect(normalizeEthicsName('Jones Sr, Robert')).toBe('jones|robert')
  })

  it('strips roman numeral suffixes (II, III, IV)', () => {
    expect(normalizeEthicsName('Brown III, William')).toBe('brown|william')
    expect(normalizeEthicsName('Davis II, James')).toBe('davis|james')
  })

  it('is case-insensitive', () => {
    expect(normalizeEthicsName('MCMASTER, HENRY')).toBe('mcmaster|henry')
  })

  it('returns lowercased input when no comma present', () => {
    expect(normalizeEthicsName('nocommaname')).toBe('nocommaname')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeEthicsName('')).toBe('')
  })
})

describe('normalizeVremsName', () => {
  it('handles standard firstName + lastName', () => {
    expect(normalizeVremsName('John', 'Smith')).toBe('smith|john')
  })

  it('strips Jr suffix embedded in lastName', () => {
    expect(normalizeVremsName('John', 'Smith Jr')).toBe('smith|john')
    expect(normalizeVremsName('John', 'Smith Jr.')).toBe('smith|john')
  })

  it('drops middle name from firstName if present', () => {
    // VREMS CSV has separate middleName field, but guard against it being in firstName
    expect(normalizeVremsName('John Alan', 'Smith')).toBe('smith|john')
  })

  it('is case-insensitive', () => {
    expect(normalizeVremsName('HENRY', 'MCMASTER')).toBe('mcmaster|henry')
  })
})

describe('cross-system name matching', () => {
  it('Ethics "Smith, John" matches VREMS firstName=John lastName=Smith', () => {
    expect(normalizeEthicsName('Smith, John')).toBe(normalizeVremsName('John', 'Smith'))
  })

  it('Ethics "Smith Jr, John" matches VREMS firstName=John lastName=Smith Jr', () => {
    expect(normalizeEthicsName('Smith Jr, John')).toBe(normalizeVremsName('John', 'Smith Jr'))
  })

  it('Ethics "Brown III, William" matches VREMS firstName=William lastName=Brown III', () => {
    expect(normalizeEthicsName('Brown III, William')).toBe(normalizeVremsName('William', 'Brown III'))
  })

  it('different last names do NOT match', () => {
    expect(normalizeEthicsName('Jones, John')).not.toBe(normalizeVremsName('John', 'Smith'))
  })

  it('different first names do NOT match', () => {
    expect(normalizeEthicsName('Smith, Bob')).not.toBe(normalizeVremsName('Robert', 'Smith'))
  })
})

describe('diffEthicsVrems', () => {
  it('matching pair → matchedCount 1, both buckets empty', () => {
    const ethics = [makeGroupedFiler('Smith, John')]
    const vrems = [makeVremsCandidate('John', 'Smith')]
    const result = diffEthicsVrems(ethics, vrems)
    expect(result.matchedCount).toBe(1)
    expect(result.matchedKeys.size).toBe(1)
    expect(result.expectedNotFiled).toHaveLength(0)
    expect(result.filedNotInEthics).toHaveLength(0)
  })

  it('Ethics only → expectedNotFiled has 1 entry, filedNotInEthics empty', () => {
    const ethics = [makeGroupedFiler('Jones, Robert')]
    const vrems: VremsCandidate[] = []
    const result = diffEthicsVrems(ethics, vrems)
    expect(result.expectedNotFiled).toHaveLength(1)
    expect(result.expectedNotFiled[0].candidate).toBe('Jones, Robert')
    expect(result.filedNotInEthics).toHaveLength(0)
    expect(result.matchedCount).toBe(0)
  })

  it('VREMS only → filedNotInEthics has 1 entry, expectedNotFiled empty', () => {
    const ethics: GroupedFiler[] = []
    const vrems = [makeVremsCandidate('Alice', 'Brown')]
    const result = diffEthicsVrems(ethics, vrems)
    expect(result.filedNotInEthics).toHaveLength(1)
    expect(result.filedNotInEthics[0].firstName).toBe('Alice')
    expect(result.expectedNotFiled).toHaveLength(0)
    expect(result.matchedCount).toBe(0)
  })

  it('mixed: one match + one from each side', () => {
    const ethics = [makeGroupedFiler('Smith, John'), makeGroupedFiler('Davis, Carol')]
    const vrems = [makeVremsCandidate('John', 'Smith'), makeVremsCandidate('Bob', 'Wilson')]
    const result = diffEthicsVrems(ethics, vrems)
    expect(result.matchedCount).toBe(1)
    expect(result.expectedNotFiled).toHaveLength(1)
    expect(result.expectedNotFiled[0].candidate).toBe('Davis, Carol')
    expect(result.filedNotInEthics).toHaveLength(1)
    expect(result.filedNotInEthics[0].lastName).toBe('Wilson')
  })

  it('duplicate Ethics name (collision) → last writer wins, only one in matched', () => {
    const gf1 = makeGroupedFiler('Smith, John')
    const gf2 = { ...makeGroupedFiler('Smith, John'), candidateFilerId: 999 }
    const vrems = [makeVremsCandidate('John', 'Smith')]
    const result = diffEthicsVrems([gf1, gf2], vrems)
    // Map key collision: last writer (gf2) wins — matchedCount still 1
    expect(result.matchedCount).toBe(1)
    expect(result.ethicsMap.get('smith|john')!.candidateFilerId).toBe(999)
    expect(result.expectedNotFiled).toHaveLength(0)
  })
})
