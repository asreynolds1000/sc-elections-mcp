# Implementation Plan: Remaining Napkin Items

## Items to Implement

### Item 5: `find_expected_filers` tool (medium priority)
Cross-reference Ethics Commission open campaigns with VREMS candidate filings. Answers: "who has an open Ethics campaign account for this county but has NOT filed in VREMS yet?"

### Item 8: Running mate field normalization (low priority)
HTML search path returns `"runningMate": "Not Designated"` while CSV path returns `"runningMate": ""`. Normalize to a consistent empty value.

---

## Item 8: Running Mate Normalization

**Root cause:** `candidate-search.ts` `parseRow()` does `cells[3]?.text?.trim() || ''`, which returns the literal text "Not Designated" from the HTML. The CSV path returns `""` for the same field.

**Fix:** In `src/parsers/candidate-search.ts`, after extracting `runningMate`, normalize "Not Designated" → `""`:
```typescript
runningMate: (cells[3]?.text?.trim() === 'Not Designated' ? '' : cells[3]?.text?.trim()) || '',
```

**Tests needed:** Add a test case to a new or existing test covering the HTML search path parser. Fabricate a minimal HTML row with `Not Designated` in cell 3, assert result is `""`.

**Files changed:** `src/parsers/candidate-search.ts`, optionally a test file.

---

## Item 5: `find_expected_filers` Tool

### What it does
Given a `county` and `election_id`, it:
1. Pulls all Ethics Commission open campaigns for the county (using `searchFilersByCounty` + enrichment, filtered to `campaignStatus === 'open'`)
2. Pulls all active VREMS candidates for that election + county (using `searchCandidates`)
3. Does a name-normalized diff to produce three buckets:
   - `expectedNotFiled` — Ethics open campaigns with NO matching VREMS filing (these people have money accounts but haven't filed on the ballot yet)
   - `filedNotInEthics` — VREMS candidates with NO matching Ethics open campaign (new candidates, or mismatched names)
   - `matched` — successfully matched pairs (cross-reference confirmed)

### Name Matching Algorithm

Ethics stores names as `"Last, First Middle"`. VREMS stores them as `firstName` + `lastName` fields.

Normalization function:
```typescript
function normalizeNameForMatch(input: string): string {
  // Ethics format: "Last, First [Middle]"
  const parts = input.split(',').map(p => p.trim().toLowerCase())
  if (parts.length >= 2) {
    const last = parts[0].replace(/\s*(jr\.?|sr\.?|ii|iii|iv)$/i, '').trim()
    const first = parts[1].split(/\s+/)[0]  // first word only (drops middle name)
    return `${last}|${first}`
  }
  return input.toLowerCase()
}

function normalizeVremsName(firstName: string, lastName: string): string {
  const last = lastName.toLowerCase().replace(/\s*(jr\.?|sr\.?|ii|iii|iv)$/i, '').trim()
  const first = firstName.toLowerCase().split(/\s+/)[0]
  return `${last}|${first}`
}
```

Match on `last|first` key (pipe-delimited to avoid partial substring issues). Known limitations:
- Won't catch name variations (Bob vs Robert, nickname differences)
- Won't catch hyphenated surnames if only one system includes the hyphen
- Document these as caveats in tool description

### Tool Interface

```typescript
server.tool(
  'find_expected_filers',
  `Cross-reference SC Ethics Commission open campaign accounts with VREMS ballot filings for a county.
  Answers "who has an Ethics account but hasn't filed on the ballot yet?" during a filing period.
  Returns three buckets: expectedNotFiled (Ethics open, no VREMS match), filedNotInEthics (VREMS filed, no Ethics match), matched (confirmed cross-reference).
  Name matching is best-effort (last name + first name token). May have false negatives for name variations.
  Takes 15-25 seconds: sweeps Ethics alphabet + VREMS query + enrichment. Cached per-call.`,
  {
    county: z.string().describe('County name (e.g. "Greenville") or code'),
    election_id: z.string().describe('VREMS election ID from list_elections'),
    office_type: z.string().optional().describe('Optional token filter on office name to narrow results (e.g. "County Council", "Sheriff")'),
    status: z.string().optional().describe('VREMS status filter (default: "Active"). Use "All" to include withdrew candidates.'),
  },
  async (...) => { ... }
)
```

### Implementation Steps

1. **`src/tools/cross-reference.ts`** — new file, exports `registerCrossReferenceTools(server)`
   - Imports: `searchFilersByCounty`, `cachedGetCampaignSummary`, `normalizeOfficeName`, `tokenMatch` from ethics-client; `searchCandidates` from vrems-client; `resolveCountyCode`, `resolveCountyName` from sc-counties; `groupFilersByPerson` from ethics-client
   - Contains name normalization helpers (private to file)
   - Implements `find_expected_filers` tool handler

2. **`src/index.ts`** — add `import { registerCrossReferenceTools } from './tools/cross-reference.js'` and call it

3. **`tests/find-expected-filers.test.ts`** — unit test for name normalization helpers (no network calls), covering:
   - Standard "Last, First" Ethics format → matches VREMS firstName/lastName
   - Suffix variants ("Smith Jr, John" matches "John Smith Jr")
   - No match case (different last names)
   - Partial first name match (full name vs initial)

### Data Flow Detail

```
searchFilersByCounty(county)
  → filers[] (all Ethics filers in county)
  → filter to lastSubmission within 2 years
  → groupFilersByPerson()
  → enrich with cachedGetCampaignSummary() in batches of 6
  → filter to campaignStatus === 'open'
  → optionally filter by office_type via tokenMatch
  → ethicsOpen: GroupedFiler[]

searchCandidates({ electionId: election_id, county: countyCode, status: status || 'Active' })
  → vremsActive: VremsCandidate[]
  → optionally filter by office if office_type provided (client-side tokenMatch on office field)

Build lookup maps:
  ethicsMap: Map<normalizedKey, GroupedFiler>
  vremsMap: Map<normalizedKey, VremsCandidate>

Diff:
  matched = keys in both maps → { ethics, vrems } pairs
  expectedNotFiled = ethicsMap keys NOT in vremsMap
  filedNotInEthics = vremsMap keys NOT in ethicsMap
```

### Output Format

```json
{
  "summary": {
    "county": "Greenville",
    "electionId": "22596",
    "ethicsOpenCount": 12,
    "vremsActiveCount": 9,
    "matchedCount": 8,
    "expectedNotFiledCount": 4,
    "filedNotInEthicsCount": 1
  },
  "expectedNotFiled": [
    { "candidate": "Smith, John", "officeName": "...", "campaignId": 12345, "balance": 5000 }
  ],
  "filedNotInEthics": [
    { "firstName": "Jane", "lastName": "Doe", "office": "County Council District 23", "dateFiled": "3/14/2026" }
  ],
  "matched": [
    { "ethics": { ... GroupedFiler ... }, "vrems": { ... VremsCandidate ... } }
  ],
  "matchingCaveats": "Name matching is last+first token only. Nicknames and middle name variants may cause false negatives."
}
```

### Enrich Cap

Same 50-filer cap as other enriched tools. For Greenville county with `active_only` effectively implied, this should be well within limits.

---

## Files Changed Summary

| File | Change |
|------|--------|
| `src/parsers/candidate-search.ts` | Normalize "Not Designated" → `""` for runningMate |
| `src/tools/cross-reference.ts` | New file — `find_expected_filers` tool |
| `src/index.ts` | Register cross-reference tools |
| `tests/find-expected-filers.test.ts` | Unit tests for name normalization |
| `tests/candidate-search.test.ts` | New test for runningMate normalization |

## Version Bump

These changes add a new tool and fix a behavioral inconsistency. Bump to `0.7.0` (minor).
