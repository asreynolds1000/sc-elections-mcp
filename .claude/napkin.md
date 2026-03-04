# Napkin — sc-elections-mcp

## Mistakes & Corrections

- **Date sort bug (2026-03-04):** `buildContributionSummary` and `buildExpenditureSummary` used lexicographic `dates.sort()` on `MM/DD/YYYY` strings. December sorts before February. Fixed: use `parseDate()` comparator.
- **Test expectations wrong for normalizeDonorName (2026-03-04):** Wrote tests assuming suffix stripping happens after comma flip. Actually: lowercase → strip periods → strip suffix → comma flip. So "Smith Jr, John" → "john smith jr" (suffix not at end of string). "Smith, J.R." → "smith" (periods stripped → "jr" → suffix stripped).
- **search_contributions missing empty guard (2026-03-04):** Had office-only guard but not all-empty guard. Calling with zero filters would hit the API and return ~79K records.

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
