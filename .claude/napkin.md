# Napkin — sc-elections-mcp

## Mistakes & Corrections

- **Date sort bug (2026-03-04):** `buildContributionSummary` and `buildExpenditureSummary` used lexicographic `dates.sort()` on `MM/DD/YYYY` strings. December sorts before February. Fixed: use `parseDate()` comparator.
- **Test expectations wrong for normalizeDonorName (2026-03-04):** Wrote tests assuming suffix stripping happens after comma flip. Actually: lowercase → strip periods → strip suffix → comma flip. So "Smith Jr, John" → "john smith jr" (suffix not at end of string). "Smith, J.R." → "smith" (periods stripped → "jr" → suffix stripped).
- **search_contributions missing empty guard (2026-03-04):** Had office-only guard but not all-empty guard. Calling with zero filters would hit the API and return ~79K records.

- **search_filers returned raw results, not grouped (2026-03-19):** Was the only search tool not using `groupFilersByPerson`. Fixed: now groups + enriches with `normalizedOffice`. Consistent with `list_filers_by_office` and `list_filers_by_county`.

## Known Quirks

- `normalizeDonorName` has false positive: initials like "J.R." become "jr" after period stripping, then get stripped as a suffix. "J.R. Smith" and "John Smith" would merge.
- `filerIdCache` and `campaignSummaryCache` grow unbounded — no eviction. Fine for election data volumes.
- No fetch timeouts on individual API calls (only sweep has 10s timeout).
- `officeId` is used as `campaignId` in `resolveCampaignContext` — works because API uses same value for both.

## Patterns

- Pure functions exported with `/** @internal — exported for testing */` comment
- Tests use fabricated data objects, no network calls
- Smoke test uses `InMemoryTransport.createLinkedPair()` from MCP SDK
- npm publish is manual: `cd ~/Code/sc-elections-mcp && npm publish` (security key via browser)

## Improvement Ideas — from 2026-03-17 filing period research session

### High priority

**1. `date_filed` filter on `search_candidates`** ✅ DONE 2026-03-17
`date_filed` param added. Client-side filter on `dateFiled` from CSV. Format: M/D/YYYY (e.g. "3/18/2026").

**2. Office text filter is broken for statewide offices** ✅ DONE 2026-03-17 (docs only)
Description updated: text filter documented as unreliable for statewide offices. Recommendation: omit filter and use `last_name` search for statewide offices.

**3. County council candidates file under General (22596), not Primary (22598)** ✅ DONE 2026-03-17 (docs only)
Note added to `search_candidates` description.

### Medium priority

**4. `list_filers_by_county` returns too much noise** ✅ DONE 2026-03-17
`active_only: true` flag added. Implies `recent_only`, filters to `campaignStatus === 'open'` after enrichment. Cuts ~46 → ~12 for Greenville.

**5. No cross-reference tool between Ethics and VREMS** ✅ DONE 2026-03-17
`find_expected_filers(county, election_id)` tool added in `src/tools/cross-reference.ts`. Three-bucket output: expectedNotFiled, filedNotInEthics, matched. Name matching via `normalizeEthicsName` / `normalizeVremsName` (last|first key, suffix-stripped). Handles CSV fallback with isError. `show_matched` param caps matched output at 20. 18 total tools.

**6. Statewide office codes reference missing from tool description** ✅ DONE 2026-03-17 (docs only)
`search_candidates` description now notes statewide text filter is unreliable and directs agents to use name search instead.

### Low priority / nice to have

**7. `search_candidates` party filter doesn't enumerate valid values** ✅ DONE 2026-03-17 (docs only)
"United Citizens" party note added to param description.

**8. Running mate field inconsistency** ✅ DONE 2026-03-17
`parseSearchHtml` now normalizes "Not Designated" → `""`. Both paths return `""` when no running mate.

## Improvement Ideas — from 2026-03-17 City of Greenville roster research

**City vs. county conflation:**
`list_filers_by_county("Greenville")` and `list_office_names(keyword="Greenville")` mix City of Greenville offices (City Council, Mayor, Commissioner of Public Works) with Greenville County offices (County Council, Sheriff, etc.). `normalizeOfficeName()` already parses body patterns but doesn't expose a `jurisdictionTier`. Fix: add `jurisdiction` param to `list_filers_by_county`, `list_filers_by_office`, `list_office_names`; surface `jurisdictionTier` ("city" | "county" | "state") on `groupFilersByPerson()` output.

**positionType not surfaced at browse time:**
`list_filers_by_office` / `list_filers_by_county` return all filers including withdrew/lost candidates — no way to filter to current officeholders without a per-filer profile call. Real case: Zach Dukes filed for Greenville Water 2023, withdrew, SEI positionType says "Candidate" but that's buried in `get_filer_profile`. Fix: attach `positionType` during `recent_only=true` enrichment; add optional `position_type` filter param. Filer-reported, not authoritative — document caveat.

**Already implemented 2026-03-17:**
- `search_filers` now accepts optional `office` post-filter (tokenMatch on officeName)
- `search_candidates` status param now documents all known values: Active, Elected, DefeatedInPrimary, DefeatedInGeneral, Withdrew

**Implemented 2026-03-17 (session 2):**
- `NormalizedOffice.jurisdictionTier` added (`city` | `county` | `state`) — computed in `normalizeOfficeName` from body type
- `jurisdiction` param added to `list_filers_by_county` and `list_filers_by_office` — filters to city/county/state offices. Computes `normalizedOffice` on-demand if enrichment hasn't run.
- `active_only` param added to `list_filers_by_county` and `list_filers_by_office` — implies `recent_only`, filters to `campaignStatus === 'open'` after enrichment. Cuts ~46 → ~12 for Greenville county.
- `date_filed` param added to `search_candidates` — client-side filter on `dateFiled` field from CSV. Format: M/D/YYYY without leading zeros (e.g. "3/18/2026").
- `search_candidates` description updated: statewide office text filter documented as unreliable (use numeric codes), county council uses General election ID (not Primary).
- `party` param updated with "United Citizens" note.

---

## Code Quality Refactor — 2026-03-17 (v0.7.0)

### Architecture
- `enrichGroupedFilersWithCampaignData(grouped, officeMatcher?)` — extracted shared helper from 3 triplicated loops. Mutates in-place. Returns `boolean` (true = capped at 50). `ENRICH_CAP=50`, `BATCH_SIZE=6` live inside the helper — they're not exports.
- `diffEthicsVrems(ethicsOpen, vremsActive)` — extracted pure fn from find_expected_filers handler. Returns Maps too so caller can build matchedPairs without second Map construction.
- `STATE_BODIES`/`COUNTY_BODIES`/`CITY_BODIES` — hoisted to module-level above `normalizeOfficeName`. Comment: "Used by normalizeOfficeName". Set position matters: they must be BEFORE `normalizeOfficeName`, not before the enrichment helper.

### Lessons
- **Set hoisting placement:** First attempt placed Sets between `cachedGetCampaignSummary` and enrichment helper JSDoc — left duplicate declarations causing TS error. Final position: Sets immediately before `normalizeOfficeName`, enrichment helper after `extractDistrictNumber`.
- **Plan review catches compile blockers:** Fresh-context subagent found 2 Red issues before implementation: (1) ESM import examples missing `.js`, (2) `diffEthicsVrems` return type referenced non-existent named types. Both would have broken the build.
- **`matched` key always-present:** Changed from conditional spread (absent when show_matched=false) to `matched: matchedPairs ?? []`. Agents should check `.length`, not truthiness.
- **election_id numeric validation:** `z.string().regex(/^\d+$/)` — added as security fix to prevent unsanitized IDs reaching VREMS API.

### npm auth
- `npm publish` requires manual `npm login` first (security key via browser). Pushed to GitHub (v0.7.0), npm publish still pending.

---

## Desktop Extension (.mcpb) — added 2026-03-09

Added one-click Claude Desktop install via `.mcpb` format. Released as v0.5.2.

**Key learnings:**
- `.mcpb` does NOT bundle Node.js — Claude Desktop ships its own runtime, so users need nothing pre-installed
- `npx @anthropic-ai/mcpb init -y` scaffolds `manifest.json` from `package.json` automatically
- Default `pack` bundles everything in the directory — naively produced 23MB. Fixed by:
  1. `.mcpbignore` file (same syntax as .gitignore) to exclude src/, tests/, hars/, etc.
  2. `scripts/pack-mcpb.sh` installs prod deps only (`npm install --omit=dev --ignore-scripts`) in a temp dir before packing → 3.5MB final size
- Output filename takes the temp dir name — script explicitly renames to `sc-elections-mcp.mcpb`
- `npm run pack:mcpb` runs build + pack script. Artifact is gitignored, attached to GitHub releases manually.
- README updated: download .mcpb → double-click → Install. That's the full user flow.
- Reusable for any MCP: copy `.mcpbignore`, `manifest.json`, `scripts/pack-mcpb.sh`, add `pack:mcpb` script to package.json.
