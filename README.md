# sc-elections-mcp

MCP server for South Carolina elections data. Combines two public data sources into 15 tools for researching candidates, campaign finance, and official disclosures.

**No API keys required** — all data comes from public government websites.

## Data Sources

| Source | URL | What it covers |
|--------|-----|----------------|
| **SC Ethics Commission** | `ethicsfiling.sc.gov` | Campaign finance reports, contributions, expenditures, Statements of Economic Interest (SEI) |
| **SC Votes / VREMS** | `vrems.scvotes.sc.gov` | Election listings, candidate filings, contact info, filing documents |

## Installation

```bash
# Claude Code
claude mcp add sc-elections -- npx -y sc-elections-mcp

# Claude Desktop — add to claude_desktop_config.json
{
  "mcpServers": {
    "sc-elections": {
      "command": "npx",
      "args": ["-y", "sc-elections-mcp"]
    }
  }
}
```

Requires **Node.js >= 20**.

## Tools

### Search & Lookup

| Tool | Description | Key params |
|------|-------------|------------|
| `search_filers` | Search candidates/officials by name (default limit 50, use last name only) | `name`, `limit`? |
| `list_filers_by_office` | Find all filers for an office; enriches with balance/campaignId when recent_only | `office`, `recent_only` |
| `get_filer_profile` | Full profile: address, phone, positions, offices | `candidate_filer_id`, `sei_filer_id` |
| `list_office_names` | Discover exact office name strings from the database (e.g. "District 50 House") | `keyword`? |

### Campaign Finance

| Tool | Description | Key params |
|------|-------------|------------|
| `get_campaign_summary` | Open/closed offices, balances, contribution totals | `candidate_filer_id` |
| `get_campaign_reports` | List filed reports (campaign_id auto-resolved) | `candidate_filer_id`, `campaign_id`?, `office`? |
| `get_campaign_report_details` | Detailed income/expenditure breakdown for a report | `report_id` |
| `get_contributions` | Contributions with metadata header, summary mode, filters | `candidate_filer_id`, `campaign_id`?, `office`?, `summary`?, `year`?, `min_amount`?, `limit`? |
| `get_expenditures` | Expenditures with metadata header, summary mode, filters | `candidate_filer_id`, `campaign_id`?, `office`?, `summary`?, `year`?, `min_amount`?, `limit`? |

### Cross-Candidate Search

| Tool | Description | Key params |
|------|-------------|------------|
| `search_expenditures` | Search expenditures across ALL candidates statewide (default limit 200) | `candidate`, `vendor_name`, `office`, `year`, `amount`, `limit`? |
| `search_contributions` | Search contributions across ALL candidates statewide (default limit 200) | `candidate`, `contributor_name`, `office`, `year`, `amount`, `limit`? |

### Statement of Economic Interest

| Tool | Description | Key params |
|------|-------------|------------|
| `get_sei_details` | Positions, business interests, income, gifts, travel, creditors, lobbyist contacts | `sei_filer_id`, `report_year` (optional) |

### Candidate Filings (SC Votes)

| Tool | Description | Key params |
|------|-------------|------------|
| `list_elections` | Browse elections by type and year; keyword filter + default limit 50 | `election_type`, `year`, `keyword`?, `limit`? |
| `search_candidates` | Search candidates in an election (default limit 50) — includes phone, email, address | `election_id`, `limit`?, plus optional filters |
| `get_candidate_details` | Filing details with document download links (filing form PDF, fee receipt) | `candidate_id`, `election_id` |

### How IDs connect

```
search_filers("name")
  → candidateFilerId, seiFilerId

get_filer_profile(candidateFilerId, seiFilerId)
  → campaignId (from openOffices / closedOffices)

Campaign tools use: campaignId + candidateFilerId
SEI tools use: seiFilerId
VREMS tools use: electionId → candidateId
```

## Workflows

### Research a Known Candidate (Ethics-first)

```
1. search_filers("mcmaster")
   → Henry McMaster: candidateFilerId: 27353, seiFilerId: 6579

2. get_contributions(candidate_filer_id: 27353, office: "Governor", summary: true)
   → Auto-resolves campaignId, returns top 20 donors + totals
   → Metadata header confirms: "Henry McMaster — Governor"

3. get_campaign_reports(candidate_filer_id: 27353)
   → Auto-resolves to most recent campaign

4. get_sei_details(6579)
   → Positions, income sources, business interests
```

For candidates with multiple campaigns, use `office` hint or explicit `campaign_id`.

### Research a Race (VREMS-first)

```
1. list_elections({ election_type: "Local", year: 2024, keyword: "Sumter" })
   → Only Sumter-area elections (not all 200+ local elections)

2. search_candidates({ election_id: "22152", status: "Elected" })
   → Who won each race — names, contact info, party

3. search_filers("winner name")
   → Bridge to Ethics: get candidateFilerId, seiFilerId
   → If no match, try last name only or spelling variations

4. get_campaign_summary(candidateFilerId)
   → Campaign finance overview
```

For staggered terms (e.g. county council), check multiple election cycles to find all current members.

### Follow the Money (Cross-search)

```
1. search_expenditures({ vendor_name: "printing", year: 2024 })
   → All candidates who paid printing vendors in 2024

2. search_contributions({ contributor_name: "smith", office: "Governor" })
   → All contributions from "smith" to Governor races

3. search_expenditures({ candidate: "haley" })
   → Everything Haley's campaigns spent money on
```

## Caveats

These two data sources are independent systems with no shared identifiers:

- **Use `list_filers_by_office` for broad discovery.** For questions like "who has filed for [office]", use `list_filers_by_office` with `recent_only: true` — it sweeps the entire Ethics Commission database by office name and enriches results with campaign balance, status, and campaignId. Takes 10-15 seconds but finds candidates invisible to name-based or cross-search tools. Supplement with a web search for candidates who haven't filed yet.
- **Office names are inconsistent within Ethics.** A candidate can have different office labels across endpoints. Use `list_office_names` to discover the exact strings the database uses (e.g., "District 50 House" not "State House District 50"). In cross-search tools, use the broadest match possible or search by candidate name instead.
- **Bridge by name, not ID.** VREMS and Ethics Commission use different ID systems. To connect a VREMS candidate to their Ethics campaign finance data, search by name using `search_filers`. Name variations (nicknames, suffixes, maiden names) may require retrying with last name only.
- **"Open campaign" ≠ "in office."** A candidate can have an open campaign account for an office they never won or no longer hold. Use VREMS election results (`status: "Elected"`) to determine current officeholders.
- **Initial Reports are the early signal.** The Ethics Commission requires candidates to file an Initial Report when they start raising or spending money — often weeks or months before the VREMS filing period opens. Look for recent Initial Reports to discover new candidates before they appear in VREMS.
- **VREMS is the authority on officeholders.** Ethics Commission tracks financial filings, not election outcomes. Only VREMS shows who filed, who won, and who withdrew.
- **All data is public.** No API keys or authentication required.
- **Filing data has processing lag.** Recent campaign activity may not appear until the next filing deadline passes and reports are processed.

## Development

```bash
git clone https://github.com/asreynolds1000/sc-elections-mcp.git
cd sc-elections-mcp
npm install
npm run dev      # Run with tsx (hot reload)
npm run build    # Compile TypeScript to dist/
npm start        # Run compiled version
```

### Testing

All tools can be tested against the live public APIs — no mocks or API keys needed.

```bash
# Quick smoke test: start the server and verify it connects
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | node dist/index.js
```

## Data Coverage

**Ethics Commission** covers anyone who has filed campaign finance reports or Statements of Economic Interest in South Carolina — from statewide offices (Governor, Attorney General) down to local fire districts and school boards. SEI reports include income sources, business interests, gifts, travel, creditors, and lobbyist contacts.

**SC Votes / VREMS** covers candidate filings for General, Special, and Local elections. The CSV export provides rich contact data (phone, email, address, filing fee) that isn't available from the HTML search alone.

## License

MIT

## Author

Alex Reynolds ([@asreynolds1000](https://github.com/asreynolds1000))
