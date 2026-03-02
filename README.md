# sc-elections-mcp

MCP server for South Carolina elections data. Combines two public data sources into 13 tools for researching candidates, campaign finance, and official disclosures.

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
| `search_filers` | Search candidates/officials by name | `name` |
| `get_filer_profile` | Full profile: address, phone, positions, offices | `candidate_filer_id`, `sei_filer_id` |

### Campaign Finance

| Tool | Description | Key params |
|------|-------------|------------|
| `get_campaign_summary` | Open/closed offices, balances, contribution totals | `candidate_filer_id` |
| `get_campaign_reports` | List all filed campaign disclosure reports | `campaign_id`, `candidate_filer_id` |
| `get_campaign_report_details` | Detailed income/expenditure breakdown for a report | `report_id` |
| `get_contributions` | All contributions for a campaign | `campaign_id`, `candidate_filer_id` |
| `get_expenditures` | All expenditures for a campaign | `campaign_id`, `candidate_filer_id` |

### Cross-Candidate Search

| Tool | Description | Key params |
|------|-------------|------------|
| `search_expenditures` | Search expenditures across ALL candidates statewide | `candidate`, `vendor_name`, `office`, `year`, `amount` |
| `search_contributions` | Search contributions across ALL candidates statewide | `candidate`, `contributor_name`, `office`, `year`, `amount` |

### Statement of Economic Interest

| Tool | Description | Key params |
|------|-------------|------------|
| `get_sei_details` | Positions, business interests, income, gifts, travel, creditors, lobbyist contacts | `sei_filer_id`, `report_year` (optional) |

### Candidate Filings (SC Votes)

| Tool | Description | Key params |
|------|-------------|------------|
| `list_elections` | Browse elections by type and year | `election_type` (General/Special/Local), `year` |
| `search_candidates` | Search candidates in an election — includes phone, email, address, filing fee | `election_id`, plus optional filters |
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

## Example Workflow

```
1. search_filers("mcmaster")
   → Henry McMaster: candidateFilerId: 27353, seiFilerId: 6579

2. get_filer_profile(27353, 6579)
   → Governor, Attorney General, Lt Governor campaigns

3. get_campaign_summary(27353)
   → Open/closed offices with balances

4. get_sei_details(6579)
   → Positions, income sources, business interests

5. search_expenditures({ candidate: "mcmaster" })
   → All expenditures across McMaster's campaigns
```

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
