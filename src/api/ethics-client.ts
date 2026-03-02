import type {
  EthicsFiler,
  FilerProfile,
  CampaignSummary,
  CampaignReport,
  CampaignReportDetails,
  CampaignContribution,
  CampaignExpenditure,
  CrossSearchExpenditure,
  CrossSearchContribution,
  SeiReport,
  SeiReportBody,
  SeiDetails,
} from '../types.js'

const BASE = 'https://ethicsfiling.sc.gov/api'

const HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

// ============================================================
// Search & Lookup
// ============================================================

export async function searchFilers(name: string): Promise<EthicsFiler[]> {
  const response = await fetch(`${BASE}/Ethics/Get/Public/Search/By/Filer/Name/`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(name.trim()),
  })
  if (!response.ok) return []
  const data = await response.json()
  return data.result || []
}

export async function getFilerProfile(
  candidateFilerId: number,
  seiFilerId: number
): Promise<FilerProfile> {
  const response = await fetch(`${BASE}/Candidate/Campaign/Get/Personal/Profile`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ candidateFilerId, seiFilerId }),
  })
  if (!response.ok) throw new Error(`Profile request failed: ${response.status}`)
  return response.json()
}

// ============================================================
// Campaign Finance — Per-Candidate
// ============================================================

export async function getCampaignSummary(candidateFilerId: number): Promise<CampaignSummary> {
  const response = await fetch(
    `${BASE}/Ethics/Get/Public/Candidate/Report/Summary/${candidateFilerId}`,
    { headers: HEADERS }
  )
  if (!response.ok) throw new Error(`Campaign summary request failed: ${response.status}`)
  return response.json()
}

export async function getCampaignReports(
  campaignId: number,
  candidateFilerId: number
): Promise<CampaignReport[]> {
  const response = await fetch(`${BASE}/Ethics/Get/Public/Candidate/Reports`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ campaignId, candidateFilerId }),
  })
  if (!response.ok) return []
  const data = await response.json()
  return data.results || data || []
}

export async function getCampaignReportDetails(reportId: number): Promise<CampaignReportDetails> {
  const response = await fetch(
    `${BASE}/Ethics/Get/Public/Candidate/Report/Details/${reportId}`,
    { headers: HEADERS }
  )
  if (!response.ok) throw new Error(`Report details request failed: ${response.status}`)
  return response.json()
}

export async function getContributions(
  campaignId: number,
  candidateFilerId: number
): Promise<CampaignContribution[]> {
  const response = await fetch(`${BASE}/Candidate/Contribution/Get/All/Campaign/Grid`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      campaignId: String(campaignId),
      candidateFilerId: String(candidateFilerId),
      isFiled: true,
    }),
  })
  if (!response.ok) return []
  return response.json()
}

export async function getExpenditures(
  campaignId: number,
  candidateFilerId: number
): Promise<CampaignExpenditure[]> {
  const response = await fetch(`${BASE}/Candidate/Expenditure/Get/All/Campaign/Grid`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      campaignId: String(campaignId),
      candidateFilerId: String(candidateFilerId),
      isFiled: true,
    }),
  })
  if (!response.ok) return []
  return response.json()
}

// ============================================================
// Campaign Finance — Cross-Candidate Search
// ============================================================

export async function searchExpenditures(filters: {
  candidate?: string
  office?: string
  vendorName?: string
  expenditureYear?: number
  vendorLoc?: string
  amount?: number
  expDesc?: string
}): Promise<CrossSearchExpenditure[]> {
  const response = await fetch(
    `${BASE}/Candidate/Expenditure/Public/Get/All/Campaign/Expenditures`,
    {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        candidate: filters.candidate || '',
        office: filters.office || '',
        vendorName: filters.vendorName || '',
        expenditureYear: filters.expenditureYear || 0,
        vendorLoc: filters.vendorLoc || 'Any',
        amount: filters.amount || 0,
        expDesc: filters.expDesc || '',
      }),
    }
  )
  if (!response.ok) return []
  return response.json()
}

export async function searchContributions(filters: {
  candidate?: string
  office?: string
  contributorName?: string
  contributionYear?: number
  contributorLoc?: string
  amount?: number
}): Promise<CrossSearchContribution[]> {
  const response = await fetch(`${BASE}/Candidate/Contribution/Search/`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      candidate: filters.candidate || '',
      office: filters.office || '',
      contributorName: filters.contributorName || '',
      contributionYear: filters.contributionYear || 0,
      contributorLoc: filters.contributorLoc || 'Any',
      amount: filters.amount || 0,
    }),
  })
  if (!response.ok) return []
  return response.json()
}

// ============================================================
// Statement of Economic Interest (SEI)
// ============================================================

export async function getSeiReportVersions(seiFilerId: number): Promise<SeiReport[]> {
  // Use the overview endpoint which returns { gridRows: [...] }
  const response = await fetch(
    `${BASE}/Sei/Report/Get/Filed/Overview/${seiFilerId}`,
    { headers: HEADERS }
  )
  if (!response.ok) return []
  const data = await response.json()
  const rows = data.gridRows || []
  return rows.map((row: any) => ({
    seiFilerId,
    seiReportId: row.reportId,
    year: parseInt(row.filingYear, 10),
    reportType: row.seiReport,
    dateSubmitted: row.submittedString || row.submitted,
    status: row.status,
  }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seiPost(path: string, body: SeiReportBody): Promise<any[]> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  if (!response.ok) return []
  const data = await response.json()
  return Array.isArray(data) ? data.filter((item: any) => !item.isDeleted) : []
}

export async function getSeiDetails(
  seiFilerId: number,
  reportYear?: number
): Promise<SeiDetails | null> {
  const reports = await getSeiReportVersions(seiFilerId)
  if (reports.length === 0) return null

  const sorted = reports.sort((a, b) => b.year - a.year)
  const report = reportYear
    ? sorted.find(r => r.year === reportYear)
    : sorted[0]

  if (!report) return null

  const body: SeiReportBody = {
    seiFilerId,
    seiReportId: report.seiReportId,
    getUnfiled: false,
  }

  const [
    positions,
    businessInterests,
    privateIncome,
    governmentIncome,
    familyPrivateIncome,
    familyGovernmentIncome,
    gifts,
    travel,
    governmentContracts,
    creditors,
    lobbyistFamily,
    lobbyistPurchases,
    regulatedBusinessAssociations,
    propertyTransactions,
    propertyImprovements,
    propertyConflicts,
    additionalInformation,
  ] = await Promise.all([
    seiPost('/Sei/Filer/Position/Get/All/Report/Positions', body),
    seiPost('/Sei/Business/Interests/Get/Many/For/Report', body),
    seiPost('/Sei/Income/And/Benefits/Get/Private/IncomeAndBenefits/For/Report', body),
    seiPost('/Sei/Income/And/Benefits/Get/Government/IncomeAndBenefits/For/Report', body),
    seiPost('/Sei/Family/Income/And/Benefits/Get/All/Private/Income/For/Report/', body),
    seiPost('/Sei/Family/Income/And/Benefits/Get/All/Government/Income/For/Report/', body),
    seiPost('/Sei/Report/Get/Gifts', body),
    seiPost('/Sei/Travel/Get/All/Travel/Records', body),
    seiPost('/Sei/Report/Get/Gov/Contracts/Records', body),
    seiPost('/Sei/Creditors/Get/Report/SeiCreditors', body),
    seiPost('/Sei/Lobbyist/Get/Many/LobbyistFamily', body),
    seiPost('/Sei/Lobbyist/Get/Many/LobbyistPurchase', body),
    seiPost('/Sei/Regulated/Business/Assoc/Get/Many/For/Report', body),
    seiPost('/Sei/Property/Sold/Leased/Rented/Get/Report/Property/Transactions', body),
    seiPost('/Sei/Property/Sold/Leased/Rented/Get/Report/Property/Improvements', body),
    seiPost('/Sei/Property/Sold/Leased/Rented/Get/Report/Property/Conflicts', body),
    seiPost('/Sei/Additional/Information/Get/Many/AdditionalInfo', body),
  ])

  return {
    seiFilerId,
    seiReportId: report.seiReportId,
    reportYear: report.year,
    dateSubmitted: report.dateSubmitted,
    positions,
    businessInterests,
    privateIncome,
    governmentIncome,
    familyPrivateIncome,
    familyGovernmentIncome,
    gifts,
    travel,
    governmentContracts,
    creditors,
    lobbyistFamily,
    lobbyistPurchases,
    regulatedBusinessAssociations,
    propertyTransactions,
    propertyImprovements,
    propertyConflicts,
    additionalInformation,
  }
}
