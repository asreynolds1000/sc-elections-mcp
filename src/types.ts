// ============================================================
// Ethics Commission types (ethicsfiling.sc.gov)
// ============================================================

/** Search result from filer name search */
export interface EthicsFiler {
  candidate: string
  address: string
  lastSubmission: string
  lastSeiReport: string
  lastCampaignDisclosureReport: string
  isAccountConsolidated: boolean
  universalUserId: number
  candidateFilerId: number
  seiFilerId: number
  officeId: number
  officeName: string
  accountType: number
  percentageAccuracy: number
}

/** Result from office-based filer search (26-letter sweep) */
export interface OfficeFilerResult {
  filers: EthicsFiler[]
  totalSearched: number
  totalFailed: number
}

/** Filer profile with positions and offices */
export interface FilerProfile {
  name: string
  address: {
    addressLine1: string
    addressLine2: string
    city: string
    zipCode: string
    county: string
    state: string
  }
  phone: string
  accountType: number
  hasSei: boolean
  hasCandidate: boolean
  isCandidateSeiMismatch: boolean
  allPositions: FilerPosition[]
  recentPositions: string[]
  openOffices: FilerOffice[]
  closedOffices: FilerOffice[]
}

export interface FilerPosition {
  id: number
  reportId: number
  reportYear: string
  position: string
  entity: string
  start: string
  startYear: string
  end: string
  endYear: string
  categoryType: string
  positionType: string
}

export interface FilerOffice {
  filerId: number
  campaignId: number
  name: string
  isClosed: boolean
  start: string
  end: string
}

/** Campaign report summary (open/closed offices with balances) */
export interface CampaignSummary {
  name: string | null
  address: string | null
  openReports: CampaignOfficeReport[]
  closedReports: CampaignOfficeReport[]
}

export interface CampaignOfficeReport {
  filerId: number
  officeId: number
  officeName: string
  initialReportFiledDate: string
  lastReportSubmitted: string
  latestActivity: string
  balance: number
  officeClosedDate: string | null
  contributions: number
}

/** Metadata header prepended to contribution/expenditure responses for verification */
export interface CampaignContext {
  candidateName: string
  officeName: string
  campaignId: number
  candidateFilerId: number
  campaignStatus: 'open' | 'closed'
}

/** Aggregated contribution view — top donors, totals by type */
export interface ContributionSummary {
  context: CampaignContext
  totalCount: number
  totalAmount: number
  dateRange: { earliest: string; latest: string } | null
  byType: Record<string, { count: number; amount: number }>
  selfFundingTotal: number
  topDonors: { name: string; totalAmount: number; count: number }[]
}

/** Aggregated expenditure view — top vendors, totals by type */
export interface ExpenditureSummary {
  context: CampaignContext
  totalCount: number
  totalAmount: number
  dateRange: { earliest: string; latest: string } | null
  byType: Record<string, { count: number; amount: number }>
  topVendors: { name: string; totalAmount: number; count: number }[]
}

/** Office name with extracted district/body for normalization */
export interface NormalizedOffice {
  raw: string
  normalized: string
  district?: string
  body?: string
  /** Jurisdiction tier derived from office body type */
  jurisdictionTier?: 'city' | 'county' | 'state'
}

/** Grouped filer result — one entry per person, with all their office filings */
export interface GroupedFiler {
  candidate: string
  address: string
  universalUserId: number
  candidateFilerId: number
  seiFilerId: number
  lastSubmission: string
  offices: {
    officeName: string
    officeId: number
    lastSubmission: string
    campaignStatus?: 'open' | 'closed'
    balance?: number
    campaignId?: number
  }[]
  primaryOfficeName?: string
  campaignStatus?: 'open' | 'closed'
  balance?: number
  campaignId?: number
  normalizedOffice?: NormalizedOffice
}

/** Cross-candidate campaign report search result (from /Candidate/Report/Public/Campaign/Get/Reports) */
export interface CrossSearchReport {
  candidateFilerId: number
  seiFilerId: number
  credentialId: number
  campaignId: number
  reportId: number
  office: string
  reportName: string
  candidateName: string
  electionyear: string
  electionType: string
  lastUpdated: string
}

/** Individual campaign report entry */
export interface CampaignReport {
  reportId: number
  report: string
  reportType: string
  electionDate: string
  filingPeriod: string
  contributions: number
  expenses: number
  balance: number
  dateSubmitted: string
  lastAmendment: string | null
  year: number
}

/** Detailed breakdown of a single campaign report */
export interface CampaignReportDetails {
  reportType: string
  filingPeriod: string
  electionDate: string
  electionType: string
  filerName: string
  isAmendment: boolean
  overview: {
    reportSequenceNumber: number
    submittedDate: string
    filingFeeAmount: number
    filingFeePaymentMethod: string
    income: ReportLineItem[]
    expenditures: ReportLineItem[]
    totals: ReportLineItem[]
  }
  contributions: unknown[]
  expenditures: unknown[]
  loans: unknown[]
}

export interface ReportLineItem {
  type: string
  filingPeriod: number
  electionCycleTotal: number
}

/** Individual contribution record */
export interface CampaignContribution {
  id: number
  date: string
  report: string
  paidBy: string
  credit: number
  type: string
  electionCycle: string
  description: string
  isRunoff: boolean
  isDebtSetOff: boolean
  filingDate: string
}

/** Individual expenditure record */
export interface CampaignExpenditure {
  id: number
  date: string
  report: string
  paidTo: string
  debit: number
  type: string
  electionCycle: string
  description: string
  isRunoff: boolean
  isDebtSetOff: boolean
  filingDate: string
}

/** Cross-candidate expenditure search result */
export interface CrossSearchExpenditure {
  candidateFilerId: number
  credentialId: number
  campaignId: number
  office: string
  candidateName: string
  expDate: string
  expId: number
  vendorName: string
  amount: number
  address: string
  expDesc: string
}

/** Cross-candidate contribution search result */
export interface CrossSearchContribution {
  contributionId: number
  officeRunId: number
  candidateId: number
  date: string
  amount: number
  candidateName: string
  officeName: string
  electionDate: string
  contributorName: string
  contributorOccupation: string
  group: string
  contributorAddress: string
  description: string | null
}

// SEI types

export interface SeiReport {
  seiFilerId: number
  seiReportId: number
  year: number
  reportType: string
  dateSubmitted: string
  status: string
}

export interface SeiReportBody {
  seiFilerId: number
  seiReportId: number
  getUnfiled: boolean
}

export interface SeiPosition {
  id: number
  reportId: number
  reportYear: string
  position: string
  entity: string
  start: string
  startYear: string
  end: string
  endYear: string
  categoryType: string
  positionType: string
}

export interface SeiBusinessInterest {
  seiFilerId: number
  seiReportId: number
  businessInterestsId: number
  businessName: string
  relationship: string
  isDeleted: boolean
}

export interface SeiIncomeSource {
  seiFilerId: number
  seiReportId: number
  incomeAndBenefitsId: number
  source: string
  type: string
  amount: number
  isDeleted: boolean
  incomeType: string
}

export interface SeiGift {
  seiFilerId: number
  seiReportId: number
  source: string
  description: string
  value: number
  isDeleted: boolean
}

export interface SeiTravel {
  seiFilerId: number
  seiReportId: number
  destination: string
  purpose: string
  paidBy: string
  dates: string
  isDeleted: boolean
}

export interface SeiCreditor {
  seiFilerId: number
  seiReportId: number
  creditorName: string
  amount: number
  isDeleted: boolean
}

export interface SeiLobbyist {
  seiFilerId: number
  seiReportId: number
  lobbyistName: string
  isDeleted: boolean
}

export interface SeiDetails {
  seiFilerId: number
  seiReportId: number
  reportYear: number
  dateSubmitted: string
  positions: SeiPosition[]
  businessInterests: SeiBusinessInterest[]
  privateIncome: SeiIncomeSource[]
  governmentIncome: SeiIncomeSource[]
  familyPrivateIncome: SeiIncomeSource[]
  familyGovernmentIncome: SeiIncomeSource[]
  gifts: SeiGift[]
  travel: SeiTravel[]
  governmentContracts: unknown[]
  creditors: SeiCreditor[]
  lobbyistFamily: SeiLobbyist[]
  lobbyistPurchases: SeiLobbyist[]
  regulatedBusinessAssociations: unknown[]
  propertyTransactions: unknown[]
  propertyImprovements: unknown[]
  propertyConflicts: unknown[]
  additionalInformation: unknown[]
}

// ============================================================
// VREMS types (vrems.scvotes.sc.gov)
// ============================================================

export interface VremsElectionYear {
  electionYear: number
}

export interface VremsElection {
  electionId: string
  electionName: string
  displayName: string
  electionDate: string
  filingPeriodBeginDate: string
}

/** Rich candidate record from CSV export (25 fields) */
export interface VremsCandidate {
  ballotSortOrder: string
  filingLevel: string
  electionName: string
  office: string
  district: string
  counties: string
  ballotFirstMiddle: string
  ballotLastSuffix: string
  runningMate: string
  firstName: string
  middleName: string
  lastName: string
  suffix: string
  party: string
  filingLocation: string
  dateFiled: string
  timeFiled: string
  filingFee: string
  status: string
  statusDate: string
  address: string
  phone: string
  email: string
  runningMateOffice: string
}

/** Lighter candidate record from HTML table parsing (fallback) */
export interface VremsSearchCandidate {
  candidateId: string
  electionId: string
  office: string
  counties: string
  name: string
  runningMate: string
  party: string
  filingLocation: string
  status: string
}

/** Candidate detail from HTML detail page */
export interface VremsCandidateDetail {
  name: string
  election: string
  office: string
  nameOnBallot: string
  party: string
  address: string
  status: string
  dateFiled: string
  locationFiled: string
  documents: VremsDocument[]
}

export interface VremsDocument {
  name: string
  type: string
  url: string
}

export interface CandidateSearchParams {
  electionId: string
  office?: string
  county?: string
  status?: string
  firstName?: string
  lastName?: string
  party?: string
  filingLocation?: string
}
