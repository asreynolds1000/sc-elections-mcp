# SC Elections MCP: South Carolina campaign finance, filings and results for AI assistants

- **What:** An MCP server with 22 tools over public South Carolina data: SC Ethics Commission campaign finance and Statements of Economic Interest, SC Votes (VREMS) candidate filings, and certified election results. It needs no API keys.
- **For:** Anyone researching South Carolina candidates, campaign money and results with Claude or another MCP client. Alex Reynolds builds and maintains it. Next steps are tracked privately.
- **Runs:** As a local stdio server from the `sc-elections-mcp` npm package (`npx -y sc-elections-mcp`). A change reaches users when a new version is published to npm. The same code also runs as a token-protected HTTP function on Vercel (`api/mcp.ts`, see `docs/HOSTING.md`). Data comes live from ethicsfiling.sc.gov, vrems.scvotes.sc.gov and the SC Election Commission results site.
- **Status:** Live (2026-11-23). npm shows version 0.9.1, and the Vercel endpoint answers 401 without a token, as designed. The last code change was 2026-10-24.

Working notes for agents: `CLAUDE.md`. API details: `API-REFERENCE.md`.

## Data Sources

| Source | URL | What it covers |
|--------|-----|----------------|
| **SC Ethics Commission** | `ethicsfiling.sc.gov` | Campaign finance reports, contributions, expenditures, Statements of Economic Interest (SEI) |
| **SC Votes / VREMS** | `vrems.scvotes.sc.gov` | Election listings, candidate filings, contact info, filing documents |

## Installation

### Claude Desktop

Add this under `mcpServers` in `claude_desktop_config.json` (see Manual config below),
then restart Claude Desktop. Node.js ships inside Claude Desktop, so there is nothing
else to install.

Try asking: *"Who has filed to run for Governor in South Carolina?"*

### Claude Code

```bash
claude mcp add sc-elections -- npx -y sc-elections-mcp
```

### Manual config

Add to your `claude_desktop_config.json`:

```json
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
| `search_filers` | Search candidates and officials (default limit 50). Start with the exact last name and verify partial matches. | `name`, `limit`? |
| `list_filers_by_office` | Find filers by office and enrich with balance and campaignId when `recent_only` is set. Verify the office on each result because the filter can match historical offices. | `office`, `recent_only` |
| `get_filer_profile` | Full profile: address, phone, positions, offices | `candidate_filer_id`, `sei_filer_id` |
| `list_office_names` | Discover exact office name strings from the database (e.g. "District 50 House") | `keyword`? |
| `list_filers_by_county` | Find all candidates/officials who have filed with the Ethics Commission in a specific county | `county` |

### Campaign Finance

| Tool | Description | Key params |
|------|-------------|------------|
| `get_campaign_summary` | Open and closed campaigns, balances, contribution totals. Use the matching entry's `officeId` as `campaign_id`. | `candidate_filer_id` |
| `get_campaign_reports` | List filed reports. Pass the explicit `campaign_id` for the office and cycle you want. | `candidate_filer_id`, `campaign_id`?, `office`? |
| `get_campaign_report_details` | Detailed income/expenditure breakdown for a report | `report_id` |
| `get_contributions` | Contributions for the selected campaign. Pass the explicit `campaign_id` and use full records to verify dates. | `candidate_filer_id`, `campaign_id`?, `office`?, `summary`?, `year`?, `min_amount`?, `limit`? |
| `get_expenditures` | Expenditures for the selected campaign. Pass the explicit `campaign_id` and use full records to verify dates. | `candidate_filer_id`, `campaign_id`?, `office`?, `summary`?, `year`?, `min_amount`?, `limit`? |

### Cross-Candidate Search

| Tool | Description | Key params |
|------|-------------|------------|
| `search_expenditures` | Search expenditures statewide (default limit 200). Query by year, check for truncation, and verify each result's office. Summaries omit dates. | `candidate`, `vendor_name`, `office`, `year`, `amount`, `summary`?, `limit`? |
| `search_contributions` | Search contributions statewide (default limit 200). Provide a filter besides office and verify each result's office. Query by year, check for truncation, and use full records for dates. | `candidate`, `contributor_name`, `office`, `year`, `amount`, `summary`?, `limit`? |
| `search_campaign_reports` | Search campaign disclosure reports across ALL candidates statewide (who filed Initial/Quarterly reports for a given year) | `year`, `report_type`?, `limit`? |

### Statement of Economic Interest

| Tool | Description | Key params |
|------|-------------|------------|
| `get_sei_details` | Positions, business interests, income, gifts, travel, creditors, lobbyist contacts | `sei_filer_id`, `report_year` (optional) |

### Candidate Filings (SC Votes)

| Tool | Description | Key params |
|------|-------------|------------|
| `list_elections` | Browse elections by type and year; keyword filter + default limit 50 | `election_type`, `year`, `keyword`?, `limit`? |
| `search_candidates` | Search candidates in an election (default limit 50). Includes phone, email, address | `election_id`, `limit`?, plus optional filters |
| `get_candidate_details` | Filing details with document download links (filing form PDF, fee receipt) | `candidate_id`, `election_id` |

### Election Results (SC Election Commission)

Certified vote data (2008-present), distinct from the Ethics/VREMS sources above. Chain: events → contests → precincts.

| Tool | Description | Key params |
|------|-------------|------------|
| `list_election_events` | List SC elections from the certified results database (2008-present); returns event IDs | `year`? |
| `search_election_results` | Certified results for an event: candidates, vote totals, percentages, winner | `event_id`, filters |
| `get_precinct_results` | Precinct-level vote counts and percentages for a specific contest | `contest_id` |

### Cross-Reference & Discovery

| Tool | Description | Key params |
|------|-------------|------------|
| `find_expected_filers` | Cross-reference Ethics open campaign accounts vs VREMS ballot filings for a county ("who has an Ethics account but hasn't filed on the ballot") | `county` |
| `find_donor_overlap` | Find donors who gave to multiple candidates by name, filer ID, or office. Use `primary_campaign_id` to select a specific primary campaign. | `primary_name` + `comparison_names`, or filer IDs, or `office`. Optional `primary_campaign_id`. |

### How IDs connect

```
search_filers("last name")
  → candidateFilerId, seiFilerId

get_filer_profile(candidateFilerId, seiFilerId)
  → campaignId (from openOffices / closedOffices)

Campaign tool inputs: campaign_id + candidate_filer_id from search_filers
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
   → The summary identifies the selected campaign

3. get_campaign_reports(candidate_filer_id: 27353)
   → The resolver prefers a single open campaign and may choose a different campaign than the one you want

4. get_sei_details(6579)
   → Positions, income sources, business interests
```

For a specific office and cycle, pass the explicit `campaign_id` from `get_campaign_summary`. If a lookup is empty, search by last name again and check both open and closed campaign entries before drawing conclusions.

### Research a Race (VREMS-first)

```
1. list_elections({ election_type: "Local", year: 2024, keyword: "Sumter" })
   → Only Sumter-area elections (not all 200+ local elections)

2. search_candidates({ election_id: "22152", status: "Elected" })
   → Who won each race: names, contact info, party

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
   → Matching expenditure records. Check for truncation.

2. search_contributions({ contributor_name: "smith", office: "Governor" })
   → Matching contribution records. Check each result's office.

3. search_expenditures({ candidate: "haley" })
   → Matching expenditure records across years. Query by year if the results truncate.
```

## Caveats

These two data sources are independent systems with no shared identifiers:

- **Use `list_filers_by_office` for broad discovery.** For questions like "who has filed for [office]", use `list_filers_by_office` with `recent_only: true`. It sweeps the entire Ethics Commission database by office name and enriches results with campaign balance, status, and campaignId. Takes 10-15 seconds but finds candidates invisible to name-based or cross-search tools. Supplement with a web search for candidates who haven't filed yet.
- **Office names are inconsistent within Ethics.** A candidate can have different office labels across endpoints. Use `list_office_names` to discover the exact strings the database uses (e.g., "District 50 House" not "State House District 50"). In cross-search tools, use the broadest match possible or search by candidate name instead.
- **Statewide transaction lists can truncate at 60,000 characters, even with `limit=0`.** Query one year at a time and check each response for truncation. For a specific campaign, use `get_contributions` or `get_expenditures` with `limit=0` for all matching records returned by SC Ethics.
- **Bridge by name, not ID.** VREMS and Ethics Commission use different ID systems. To connect a VREMS candidate to their Ethics campaign finance data, search by name using `search_filers`. Name variations (nicknames, suffixes, maiden names) may require retrying with last name only.
- **"Open campaign" ≠ "in office."** A candidate can have an open campaign account for an office they never won or no longer hold. Use VREMS election results (`status: "Elected"`) to determine current officeholders.
- **Initial Reports are the early signal.** The Ethics Commission requires candidates to file an Initial Report when they start raising or spending money, often weeks or months before the VREMS filing period opens. Look for recent Initial Reports to discover new candidates before they appear in VREMS.
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
npm test         # Run the vitest suite
npm start        # Run compiled version
```

### Testing

All tools can be tested against the live public APIs, no mocks or API keys needed.

```bash
# Quick smoke test: start the server and verify it connects
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | node dist/index.js
```

## Data Coverage

**Ethics Commission** covers anyone who has filed campaign finance reports or Statements of Economic Interest in South Carolina, from statewide offices (Governor, Attorney General) down to local fire districts and school boards. SEI reports include income sources, business interests, gifts, travel, creditors, and lobbyist contacts.

**SC Votes / VREMS** covers candidate filings for General, Special, and Local elections. The CSV export provides rich contact data (phone, email, address, filing fee) that isn't available from the HTML search alone.

## License

MIT

## Author

Alex Reynolds ([@asreynolds1000](https://github.com/asreynolds1000))
