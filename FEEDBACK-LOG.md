# SC Elections MCP — User Feedback Log

Track real-world usage issues to improve tool reliability and LLM guidance over time.

## Format

Each entry: date, user query, what went wrong, root cause, fix status.

---

## 2026-03-13: Steve Shaw contributions returned $0

**User query:** "Can you tell me about Steve Shaw's donors?"

**What went wrong:** Tool returned 0 contributions (later 2 contributions / $1,100) for Steve Shaw's Greenville County Council campaign, which actually has $105K+ in contributions.

**Root cause:** Steve Shaw has two campaigns with different `filerId` values:
- County Council (open): `filerId: 27934`, `officeId: 45412`
- District 6 Senate (closed): `filerId: 50495`, `officeId: 74907`

`search_filers` returned `candidateFilerId: 50495` (Senate). `resolveCampaignContext` correctly picked the open County Council campaign, but `getContributions()` was called with the original `candidateFilerId` (50495) instead of the resolved campaign's `filerId` (27934). The Ethics API silently returned only contributions matching filerId 50495.

**Fix:** Use `office.filerId` from the resolved campaign context instead of the search-result `candidateFilerId`. Applied to `getContributions`, `getExpenditures`, and `find_donor_overlap`. Committed in v0.5.2.

**Scope:** Affects any candidate who has campaigns for multiple offices (common for county council members who also ran for state senate, etc.).

---

## 2026-03-13: "Who filed an initial report?" not understood

**User query:** "Can you tell me anyone who made an initial filing in 2025 or 2026?"

**What went wrong:** The LLM didn't understand "initial filing" as a specific concept. It returned candidates filtered by `lastSubmission` date rather than `initialReportFiledDate`.

**Root cause:** Tool descriptions for `get_campaign_summary` and `list_filers_by_office` didn't mention `initialReportFiledDate` or explain its significance. The LLM had no way to know this field exists.

**Fix:** Updated tool descriptions to call out `initialReportFiledDate` and explain how to use it to find new candidates entering races. Applied to `get_campaign_summary` and `list_filers_by_office`.

**Future improvement:** Consider adding a dedicated `find_new_candidates` tool that wraps `list_filers_by_office` + filters by `initialReportFiledDate` range.

---

## 2026-03-13: search_filers("Shaw, Steve") returns no results

**User query:** (indirect — LLM searched for Steve Shaw)

**What went wrong:** Searching `"Shaw, Steve"` returns zero results even though "Shaw, Steve" exists in the database. Searching just `"Shaw"` finds him.

**Root cause:** The Ethics Commission API's search algorithm does fuzzy matching on the combined "Last, First" field. Multi-word queries with both last and first name seem to fail. The tool description already warns about this ("use last name only for best results") but the LLM calling it didn't follow the guidance.

**Fix:** No code fix needed — this is an upstream API limitation. The tool description already has the warning. Could consider adding client-side retry logic (if "Last, First" returns 0 results, retry with just "Last"), but this risks false positives.

**Future improvement:** Consider adding client-side fallback: if a comma-separated query returns 0 results, automatically retry with just the last name portion and filter client-side.
