# SC Ethics Commission API Reference

Base URL: `https://ethicsfiling.sc.gov/api`

All endpoints: `Content-Type: application/json`, no auth required.

---

## Two Independent Systems

| System | Base URL | IDs | Covers |
|--------|----------|-----|--------|
| **Ethics Commission** | `ethicsfiling.sc.gov/api` | `candidateFilerId`, `seiFilerId`, `campaignId` | Campaign finance, contributions, expenditures, SEI disclosures |
| **VREMS / SC Votes** | `vrems.scvotes.sc.gov` | `electionId`, `candidateId` | Election listings, candidate filings, contact info |

These systems **do not share IDs**. Bridge between them by searching names. See [Caveats](README.md#caveats) for details on name matching and office name differences.

---

## 1. Search & Lookup

### Search Filers by Name

```
POST /Ethics/Get/Public/Search/By/Filer/Name/
Body: "haley"  (JSON string, not object)
```

Response:
```json
{
  "result": [
    {
      "candidate": "Haley, Nikki R.",
      "address": "259 Cord Grass Ct Kiawah Island, SC 29455",
      "lastSubmission": "03/30/2025",
      "lastSeiReport": "2025",
      "lastCampaignDisclosureReport": "09/23/2019",
      "isAccountConsolidated": true,
      "universalUserId": 3294,
      "candidateFilerId": 5890,
      "seiFilerId": 2750,
      "officeId": 0,
      "officeName": "District 87 House, Governor",
      "accountType": 0,
      "percentageAccuracy": 1.0,
      "encryptedSsn": null
    }
  ]
}
```

**Notes:**
- Body is a raw JSON string (quoted), not an object
- Returns multiple results for common names
- `candidateFilerId` = ID for campaign finance endpoints
- `seiFilerId` = ID for SEI endpoints
- `percentageAccuracy` = fuzzy match score (1.0 = exact)
- Search returns results for partial matches

### Get Office and Name

```
GET /Ethics/Get/Public/Office/And/Name/{personId}
```

Response:
```json
{
  "name": "Henry McMaster",
  "office": "Governor"
}
```

### Get Personal Profile

```
POST /Candidate/Campaign/Get/Personal/Profile
Body: { "candidateFilerId": 27353, "seiFilerId": 6579 }
```

Response:
```json
{
  "name": "Henry McMaster",
  "address": {
    "addressLine1": "1100 Gervais Street",
    "addressLine2": "",
    "city": "Columbia",
    "zipCode": "29201",
    "county": "Richland",
    "state": "SC"
  },
  "phone": "(803) 734-1229",
  "accountType": 0,
  "hasSei": true,
  "hasCandidate": true,
  "isCandidateSeiMismatch": false,
  "allPositions": [
    {
      "id": 95442,
      "reportId": 208503,
      "reportYear": "2025",
      "position": "Governor",
      "entity": "Gov's Office-Exec Pol/Program",
      "start": "1/2023",
      "startYear": "2023",
      "end": "1/2027",
      "endYear": "2027",
      "categoryType": "State Agency",
      "positionType": "Elected"
    }
  ],
  "recentPositions": ["Governor"],
  "openOffices": [],
  "closedOffices": [
    {
      "filerId": 1366,
      "campaignId": 1393,
      "name": "Attorney General",
      "isClosed": true,
      "start": "2008-03-27T00:00:00",
      "end": "2012-01-01T00:00:00"
    }
  ]
}
```

---

## 2. Campaign Finance — Per-Candidate

### Campaign Report Summary

```
GET /Ethics/Get/Public/Candidate/Report/Summary/{candidateFilerId}
```

Response:
```json
{
  "name": null,
  "address": null,
  "openReports": [],
  "closedReports": [
    {
      "filerId": 1366,
      "officeId": 1393,
      "officeName": "Attorney General",
      "initialReportFiledDate": "2008-03-27T00:00:00",
      "lastReportSubmitted": "Final Report 2012",
      "latestActivity": "Report ( January 01, 2012)",
      "balance": 0.0,
      "officeClosedDate": "2012-01-01T17:57:05.173",
      "contributions": 1479784.54
    }
  ]
}
```

### List Campaign Reports

```
POST /Ethics/Get/Public/Candidate/Reports
Body: { "campaignId": 7270, "candidateFilerId": 6579 }
```

Returns array of report summaries for that campaign.

### Campaign Report Details

```
GET /Ethics/Get/Public/Candidate/Report/Details/{reportId}
```

Response:
```json
{
  "reportType": "Final Report 2009",
  "filingPeriod": "10/20/2009 - 12/17/2009",
  "electionDate": "2009-11-03T00:00:00",
  "electionType": "General",
  "filerName": "Henry McMaster",
  "isAmendment": false,
  "overview": {
    "reportSequenceNumber": 2,
    "submittedDate": "December 17, 2009",
    "filingFeeAmount": 0.0,
    "filingFeePaymentMethod": "Personal Funds",
    "income": [
      { "type": "Cash Contributions", "filingPeriod": 0.0, "electionCycleTotal": 0.0 },
      { "type": "In-kind Contributions", "filingPeriod": 0.0, "electionCycleTotal": 0.0 },
      { "type": "Debt Setoff Funds", "filingPeriod": 0.0, "electionCycleTotal": 0.0 },
      { "type": "Personal Contributions", "filingPeriod": 206.0, "electionCycleTotal": 206.0 },
      { "type": "Loans", "filingPeriod": 0.0, "electionCycleTotal": 0.0 },
      { "type": "Account Credits", "filingPeriod": 0.0, "electionCycleTotal": 0.0 },
      { "type": "Total", "filingPeriod": 206.0, "electionCycleTotal": 206.0 }
    ],
    "expenditures": [
      { "type": "Expenditures", "filingPeriod": 206.0, "electionCycleTotal": 206.0 },
      { "type": "Total", "filingPeriod": 206.0, "electionCycleTotal": 206.0 }
    ],
    "balance": 0.0,
    "outstandingLoans": 0.0
  }
}
```

### Get Single Campaign

```
GET /Candidate/Campaign/Get/One/{campaignId}
```

Response:
```json
{
  "id": 78882,
  "officeType": 4,
  "electionDate": "2026-06-09T04:00:00",
  "electionTypeId": 4,
  "candidateFilerId": 5890,
  "campaignYear": 2018,
  "reports": [
    {
      "id": 300000,
      "startDate": "2018-01-01T00:00:00",
      "endDate": "2018-06-30T00:00:00",
      "isFiled": true,
      "isInitial": false
    }
  ],
  "name": "Governor",
  "upcomingElection": "General: November 06, 2018",
  "status": "Up To Date"
}
```

### Contributions Grid (per-campaign)

```
POST /Candidate/Contribution/Get/All/Campaign/Grid
Body: { "campaignId": "7270", "candidateFilerId": "6579", "isFiled": true }
```

Response (array):
```json
[
  {
    "id": 2173837,
    "date": "2026-02-24T05:00:00",
    "report": "Initial Report 2026",
    "paidBy": "Michael  Moore",
    "credit": 1000.0,
    "type": "Individual Contribution",
    "electionCycle": "Primary - 6/9/2026",
    "description": "",
    "isRunoff": false,
    "isDebtSetOff": false,
    "filingDate": "2026-02-25T15:14:24.403"
  }
]
```

### Expenditures Grid (per-campaign)

```
POST /Candidate/Expenditure/Get/All/Campaign/Grid
Body: { "campaignId": "7270", "candidateFilerId": "6579", "isFiled": true }
```

Response: same structure as contributions but with `paidTo` and `debit` instead of `paidBy` and `credit`.

### Contributors List

```
PUT /Contributor/Get/Grid/
Body: { "campaignId": "7270", "participantId": "6579", "isFiled": false, "isPublic": true }
```

Response (array):
```json
[
  {
    "contributorId": 100000,
    "contributorName": "John Smith",
    "address": "123 Main St, Columbia, SC 29201",
    "contributions": 1,
    "mostRecentDate": "2018-09-15T05:00:00",
    "showInSearch": true,
    "electionCycle": "General - 11/6/2018"
  }
]
```

### Vendors List

```
PUT /Vendor/Get/Grid/
Body: { "campaignId": "7270", "participantId": 6579, "isFiled": false }
```

Response: similar to contributors but for vendors/payees.

---

## 3. Campaign Finance — Cross-Candidate Search

### Search Expenditures (across all candidates)

```
POST /Candidate/Expenditure/Public/Get/All/Campaign/Expenditures
Body: {
  "candidate": "",
  "office": "",
  "vendorName": "printing",
  "expenditureYear": 2024,
  "vendorLoc": "Any",
  "amount": 0,
  "expDesc": ""
}
```

Response (array):
```json
[
  {
    "candidateFilerId": 12345,
    "credentialId": 56789,
    "campaignId": 77000,
    "office": "State House District 1",
    "candidateName": "Smith, Jane",
    "expDate": "2024-06-15T05:00:00",
    "expId": 1000001,
    "vendorName": "ABC Printing",
    "amount": 500.0,
    "address": "123 Main St Columbia,SC 29201",
    "expDesc": "Campaign mailers"
  }
]
```

**Filter fields:**
- `candidate` — candidate name (partial match)
- `office` — office name (partial match)
- `vendorName` — vendor/payee name (partial match)
- `expenditureYear` — 0 for all years, or specific year (e.g., 2024)
- `vendorLoc` — "Any" or specific location
- `amount` — minimum amount filter (0 for no minimum)
- `expDesc` — description text filter

### Search Contributions (across all candidates)

```
POST /Candidate/Contribution/Search/
Body: (same filter pattern as expenditures — exact fields TBD, likely mirrors expenditure search with contributor instead of vendor)
```

---

## 4. Statement of Economic Interest (SEI)

### SEI Filing Overview

```
GET /Sei/Report/Get/Filed/Overview/{seiFilerId}
```

### SEI Report Versions

```
POST /Sei/Report/Get/All/Versions/By/Model
Body: { "seiFilerId": <id> }  (exact shape TBD)
```

### Positions Held

```
POST /Sei/Filer/Position/Get/All/Report/Positions
Body: { "seiFilerId": <id>, "seiReportId": <id> }
```

### Business Interests

```
POST /Sei/Business/Interests/Get/Many/For/Report
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Private Income

```
POST /Sei/Income/And/Benefits/Get/Private/IncomeAndBenefits/For/Report
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

Response (array):
```json
[
  {
    "seiFilerId": 2750,
    "seiReportId": 200000,
    "incomeAndBenefitsId": 100000,
    "source": "Exelis Inc",
    "type": "Salary",
    "amount": 0,
    "isDeleted": false,
    "incomeType": "Private"
  }
]
```

### Government Income

```
POST /Sei/Income/And/Benefits/Get/Government/IncomeAndBenefits/For/Report
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Family Private Income

```
POST /Sei/Family/Income/And/Benefits/Get/All/Private/Income/For/Report/
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Family Government Income

```
POST /Sei/Family/Income/And/Benefits/Get/All/Government/Income/For/Report/
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Gifts

```
POST /Sei/Report/Get/Gifts
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Travel Records

```
POST /Sei/Travel/Get/All/Travel/Records
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Government Contracts

```
POST /Sei/Report/Get/Gov/Contracts/Records
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Creditors

```
POST /Sei/Creditors/Get/Report/SeiCreditors
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Lobbyist — Family

```
POST /Sei/Lobbyist/Get/Many/LobbyistFamily
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Lobbyist — Purchases

```
POST /Sei/Lobbyist/Get/Many/LobbyistPurchase
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Regulated Business Associations

```
POST /Sei/Regulated/Business/Assoc/Get/Many/For/Report
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Property Transactions

```
POST /Sei/Property/Sold/Leased/Rented/Get/Report/Property/Transactions
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Property Improvements

```
POST /Sei/Property/Sold/Leased/Rented/Get/Report/Property/Improvements
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Property Conflicts

```
POST /Sei/Property/Sold/Leased/Rented/Get/Report/Property/Conflicts
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Additional Information

```
POST /Sei/Additional/Information/Get/Many/AdditionalInfo
Body: { "seiFilerId": <id>, "seiReportId": <id>, "getUnfiled": false }
```

### Is General Assembly Member

```
POST /Sei/General/Assembly/Get/isSeiGeneralAssemblyMember
Body: { "seiFilerId": <id> }
```

---

## 5. Reference Data

### General Statistics

```
GET /Ethics/Get/Public/General/Statistics
```

Response:
```json
{
  "lastDateOfAnyCandidateReportFilingCount": 1,
  "lastDateOfAnyCandidateReportFiling": "today",
  "lastDateOfAnySeiReportFilingCount": 53,
  "lastDateOfAnySeiReportFiling": "today"
}
```

### Entity Positions / Categories (for SEI dropdowns)

```
GET /Sei/Filer/Position/Get/Entities/For/Sei/Position          (259KB — large reference list)
GET /Sei/Filer/Position/Get/Entity/Positions/For/Sei/Position   (10KB)
GET /Sei/Filer/Position/Get/Entity/Categories/For/Sei/Position  (1.4KB)
GET /Sei/Filer/Position/Get/State/Entity/Elected/Positions/Elected    (741b)
GET /Sei/Filer/Position/Get/State/Entity/Elected/Positions/Appointed  (562b)
GET /Sei/Filer/Position/Get/State/Entity/Elected/Positions/Employee   (753b)
```

---

## Key ID Relationships

```
Search by name → candidateFilerId + seiFilerId
                        ↓                    ↓
              Campaign Finance           SEI Reports
                        ↓                    ↓
         campaignId (from profile)    seiReportId (from report list)
                        ↓                    ↓
              Contributions           Business Interests
              Expenditures            Income Sources
              Reports                 Gifts, Travel, etc.
```

## officeId == campaignId Mapping

In the Campaign Report Summary endpoint, `CampaignOfficeReport.officeId` is the same value used as `campaignId` in per-campaign endpoints (contributions, expenditures, reports). This was confirmed empirically with McMaster's data: his Attorney General campaign has `officeId: 1393` in the summary response, and `campaignId: 1393` works for fetching contributions.

The `resolveCampaignContext` helper in `ethics-client.ts` relies on this mapping to auto-resolve campaigns. If this breaks for edge cases, the function returns a prescriptive error listing available campaigns with their IDs.

## Office Name Cache (v0.4.0)

The `listOfficeNames()` function exposes a cache of distinct office name strings from the filer database. The cache is populated as a side effect of the 26-letter sweep used by `searchFilersByOffice()`. The sweep and office name discovery share the same `sweepAllFilers()` function — whichever runs first populates the cache for both.

**Important:** The cached names come from `EthicsFiler.officeName`, which is a filer-reported field that can contain comma-separated values for multiple offices (e.g. "District 87 House, Governor"). The cache splits these into individual entries. These names may differ slightly from `CampaignOfficeReport.officeName` used by `resolveCampaignContext`. Use them for discovery and partial matching, not as guaranteed exact inputs.

## Default Limits (v0.4.0)

| Tool | Default limit | Override |
|------|--------------|----------|
| `search_filers` | 50 | `limit=0` for all |
| `search_candidates` | 50 | `limit=0` for all |
| `list_elections` | 50 | `limit=0` for all |
| `search_expenditures` | 200 | `limit=0` for all |
| `search_contributions` | 200 | `limit=0` for all |
| `get_contributions` | 200 | `limit=0` for all |
| `get_expenditures` | 200 | `limit=0` for all |

## Known Quirks

- Name search body is a raw JSON string (`"haley"`), not `{"name": "haley"}`
- Some endpoints use POST, some use PUT (Contributor/Vendor grids use PUT)
- `candidateFilerId` and `participantId` are sometimes strings, sometimes numbers in request bodies
- `isFiled` parameter: `true` for filed records only, `false` for all including unfiled
- `isPublic: true` required on Contributor grid
- Cross-candidate expenditure search with all empty/zero filters returns recent filings across the state
- Person can have multiple `candidateFilerId` values (one per office they've run for)
- SEI report fields return `[]` (empty array) when no data, not null
- `isDeleted` field on SEI sub-records — filter these out in display
