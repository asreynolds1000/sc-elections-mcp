# SC Elections MCP Server

MCP server combining two South Carolina public data sources:
- **SC Ethics Commission** (`ethicsfiling.sc.gov/api`) — campaign finance, contributions, expenditures, SEI disclosures
- **SC Votes / VREMS** (`vrems.scvotes.sc.gov`) — election listings, candidate filings, contact info

## Tech Stack

- TypeScript, MCP SDK (`@modelcontextprotocol/sdk`), `node-html-parser`
- No auth required — all public data, no keys
- Stdio transport (standard MCP pattern)
- Node >= 20 required (`getSetCookie()` for VREMS session cookies)

## API Base URLs

- **Ethics**: `https://ethicsfiling.sc.gov/api` — JSON APIs, `Content-Type: application/json`
- **VREMS**: `https://vrems.scvotes.sc.gov` — mix of JSON + HTML/CSV, no auth

## Project Structure

```
sc-elections-mcp/
├── src/
│   ├── index.ts              # Shebang + server init + tool registration
│   ├── types.ts              # All interfaces (Ethics + VREMS)
│   ├── api/
│   │   ├── ethics-client.ts  # HTTP client for ethicsfiling.sc.gov
│   │   └── vrems-client.ts   # Session-aware client for vrems.scvotes.sc.gov
│   ├── parsers/
│   │   ├── candidate-search.ts  # HTML table → structured data
│   │   ├── candidate-detail.ts  # HTML detail page → structured data
│   │   └── csv-export.ts        # 25-column CSV → structured data
│   └── tools/
│       ├── search.ts         # search_filers, get_filer_profile
│       ├── campaign.ts       # campaign summary/reports/details/contributions/expenditures
│       ├── cross-search.ts   # search_expenditures, search_contributions
│       ├── overlap.ts        # find_donor_overlap (cross-candidate donor analysis)
│       ├── sei.ts            # get_sei_details (aggregates 17 sub-endpoints)
│       └── vrems.ts          # list_elections, search_candidates, get_candidate_details
├── tests/                   # vitest unit + smoke tests (33 tests)
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── API-REFERENCE.md
```

## MCP Tools (16 tools)

### Search & Lookup (Ethics)
1. **search_filers** — Search for candidates/officials by name. Default limit 50 (0 for all). Use last name only for best results.
2. **list_filers_by_office** — Find all filers for a specific office (sweeps entire database, cached 30 min). Returns grouped results — one entry per person with offices[] sub-array. With `recent_only: true`, enriches with campaign balance, status, campaignId. `active_since` filters by year.
3. **get_filer_profile** — Full profile (address, positions, offices)
4. **list_office_names** — Discover exact office name strings from the filer database. Use these with list_filers_by_office for precise matching. Optional keyword filter. First call triggers sweep (~10-15 sec), cached 30 min after.

### Campaign Finance (Ethics)
5. **get_campaign_summary** — Report summary with balances, open/closed offices
6. **get_campaign_reports** — List filed reports. campaign_id optional (auto-resolved), office hint to disambiguate
7. **get_campaign_report_details** — Detailed breakdown of a single report
8. **get_contributions** — Contributions with metadata header for verification. campaign_id optional (auto-resolved), office hint, summary mode (top 20 donors), year/min_amount/limit filters. Auto-resolves candidate name from profile when summary.name is null.
9. **get_expenditures** — Expenditures with metadata header. Same features as get_contributions. Auto-resolves candidate name.

### Cross-Candidate Search (Ethics)
10. **search_expenditures** — Search expenditures across ALL candidates. At least one filter required. `slim` strips address fields, `summary` groups by vendor. Auto-truncates at 60K chars. Default limit 200.
11. **search_contributions** — Search contributions across ALL candidates. `slim` strips address/occupation, `summary` groups by candidate. Auto-truncates at 60K chars. Office filter broken server-side.

### Donor Analysis (Ethics)
12. **find_donor_overlap** — Find shared donors between candidates. Two modes: explicit (up to 20 comparison IDs) or office-based (auto-discovers candidates, max 25). Normalizes donor names (Last,First ↔ First Last, strips suffixes). Returns ranked by total given.

### Statement of Economic Interest (Ethics)
13. **get_sei_details** — Full SEI report: positions, business interests, income, gifts, travel, creditors, lobbyist contacts

### Candidate Filings (VREMS)
14. **list_elections** — Browse SC elections by type (General/Special/Local) and year. Keyword filter + default limit 50. Use keyword to filter by location (e.g. "Sumter").
15. **search_candidates** — Search candidates in an election. Default limit 50 (0 for all). Rich data via CSV export.
16. **get_candidate_details** — Candidate filing details with document download links (filing form PDF, fee receipt)

## Recommended Workflow for Broad Candidate Discovery

For questions like "who is running for [office]":

1. **list_office_names** (if unsure of office format) — discover exact office name strings (e.g. "District 50 House" not "State House District 50"). First call ~10-15 sec, then cached.
2. **list_filers_by_office** with `recent_only: true` — sweeps the entire Ethics database (~10-15 sec), returns enriched results including campaign balance, status, and campaignId. No need for a separate `get_campaign_summary` call.
3. **get_contributions/get_expenditures** — campaign_id is optional; auto-resolved for single-campaign candidates. Use `summary: true` for high-volume campaigns. Every response includes a metadata header for verification.
4. **Cross-reference with VREMS** — once the filing period opens, `search_candidates` (with keyword filter on `list_elections` to find the right election) provides the authoritative candidate list with contact info.
5. **Web search for unfiled candidates** — catches candidates who announced but haven't filed yet.

For donor overlap analysis (e.g. "who shares funders with Candidate X?"):
- **find_donor_overlap** with `office` param auto-discovers comparison candidates and computes overlap in one call
- Or pass explicit `comparison_candidate_filer_ids` for targeted comparisons

The Ethics cross-search tools (search_expenditures/search_contributions) are useful for financial sweeps but have office name inconsistencies. The contribution office filter is broken server-side — use `list_filers_by_office` + per-candidate `get_contributions` instead. Use `slim=true` or `summary=true` for broad searches to avoid overflow.

## Key API Quirks

- **Office name inconsistency** (CRITICAL): The Ethics API uses different office names across endpoints. A county council candidate may appear under a shortened or coded office name in expenditure/contribution results vs their full office name in their profile. When using the office filter in cross-search tools, use the broadest match possible (e.g. "greenville" not "greenville county council") or omit office and search by candidate name instead.
- Ethics name search body is a raw JSON string (`"haley"`), not `{"name": "haley"}`
- Ethics uses mixed POST/PUT (Contributor/Vendor grids use PUT)
- VREMS candidate search returns HTML, not JSON — parsed with node-html-parser
- VREMS CSV export requires session cookie from prior search POST
- SEI overview endpoint returns `{ gridRows: [...] }` — use `reportId` and `filingYear`

## Testing

Test against real APIs — no mocks needed. Good test candidates:
- `search_filers("mcmaster")` — Henry McMaster, Governor (candidateFilerId: 27353, seiFilerId: 6579)
- `search_filers("haley")` — Nikki R. Haley, former Governor (candidateFilerId: 5890, seiFilerId: 2750)
- `search_expenditures({vendor_name: "printing"})` — cross-candidate vendor search
- `list_elections({election_type: "General", year: 2024})` — 4 elections
- `search_candidates({election_id: "22121"})` — 2024 Statewide Primary
- `get_candidate_details` — use candidateId + electionId from search_candidates results

## Commands

```bash
npm run dev      # Run with tsx (development)
npm run build    # Compile to dist/
npm test         # Run vitest (33 tests: 32 unit + 1 smoke)
npm start        # Run compiled version
npm run pack:mcpb  # Build Desktop Extension (.mcpb) for Claude Desktop
```

## Publishing

```bash
# npm (for Claude Code / manual config users)
claude mcp add sc-elections -- npx -y sc-elections-mcp

# Desktop Extension (for Claude Desktop one-click install)
npm run pack:mcpb  # produces sc-elections-mcp.mcpb (3.5MB)
# Attach to GitHub release — README links to releases/latest/download/sc-elections-mcp.mcpb
```
