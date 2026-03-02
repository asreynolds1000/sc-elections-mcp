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
│       ├── sei.ts            # get_sei_details (aggregates 17 sub-endpoints)
│       └── vrems.ts          # list_elections, search_candidates, get_candidate_details
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── API-REFERENCE.md
```

## MCP Tools (13 tools)

### Search & Lookup (Ethics)
1. **search_filers** — Search for candidates/officials by name
2. **get_filer_profile** — Full profile (address, positions, offices)

### Campaign Finance (Ethics)
3. **get_campaign_summary** — Report summary with balances, open/closed offices
4. **get_campaign_reports** — List all filed campaign disclosure reports
5. **get_campaign_report_details** — Detailed breakdown of a single report
6. **get_contributions** — All contributions for a specific campaign
7. **get_expenditures** — All expenditures for a specific campaign

### Cross-Candidate Search (Ethics)
8. **search_expenditures** — Search expenditures across ALL candidates by vendor, candidate, office, year, amount
9. **search_contributions** — Search contributions across ALL candidates

### Statement of Economic Interest (Ethics)
10. **get_sei_details** — Full SEI report: positions, business interests, income, gifts, travel, creditors, lobbyist contacts

### Candidate Filings (VREMS)
11. **list_elections** — Browse SC elections by type (General/Special/Local) and year
12. **search_candidates** — Search candidates in an election. Rich data via CSV export: name, office, party, status, address, phone, email, filing fee
13. **get_candidate_details** — Candidate filing details with document download links (filing form PDF, fee receipt)

## Key API Quirks

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
npm start        # Run compiled version
```

## Publishing

```bash
claude mcp add sc-elections -- npx -y sc-elections-mcp
```
