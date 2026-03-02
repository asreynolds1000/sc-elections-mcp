import { parse, type HTMLElement } from 'node-html-parser'
import type { VremsCandidateDetail, VremsDocument } from '../types.js'

/**
 * Parse the HTML detail page returned by VREMS CandidateDetail GET.
 *
 * Page structure uses:
 *   <span class="label-min-width font-bold">Label:</span>
 *   <span class="text-min-width">Value</span>
 *
 * Documents use <a class="document-link"> with JS click handlers containing
 * candidateId and documentTypeSid variables.
 */
export function parseCandidateDetail(html: string): VremsCandidateDetail {
  const root = parse(html)

  // Extract candidateId from hidden input for document URLs
  const candidateId = root.querySelector('input#CandidateId')?.getAttribute('value')
    || root.querySelector('input[name="CandidateId"]')?.getAttribute('value')
    || ''

  return {
    name: extractFirstH2(root),
    election: extractLabelValue(root, 'Election'),
    office: extractLabelValue(root, 'Office'),
    nameOnBallot: extractLabelValue(root, 'Name on Ballot'),
    party: extractLabelValue(root, 'Party'),
    address: extractLabelValue(root, 'Address'),
    status: extractLabelValue(root, 'Status'),
    dateFiled: extractLabelValue(root, 'Date Filed'),
    locationFiled: extractLabelValue(root, 'Location Filed'),
    documents: parseDocuments(root, candidateId, html),
  }
}

/**
 * Get the first h2 that isn't "Candidate Documents" or similar section header.
 */
function extractFirstH2(root: HTMLElement): string {
  const h2s = root.querySelectorAll('h2')
  for (const h2 of h2s) {
    const text = h2.text.trim()
    if (text && !text.includes('Document')) {
      return text
    }
  }
  return ''
}

/**
 * Extract value from the VREMS label/value span pattern:
 *   <span class="label-min-width font-bold">Label:</span>
 *   <span class="text-min-width">Value</span>
 */
function extractLabelValue(root: HTMLElement, label: string): string {
  const spans = root.querySelectorAll('span.label-min-width')
  for (const span of spans) {
    const text = span.text.trim().replace(/:$/, '')
    if (text === label) {
      const next = span.nextElementSibling
      if (next) {
        return next.text.trim()
      }
    }
  }
  return ''
}

/**
 * Parse document links from the detail page.
 * Documents use <a class="document-link"> with JS click handlers.
 * The JS extracts candidateId and documentTypeSid from data attributes on the row.
 */
function parseDocuments(root: HTMLElement, candidateId: string, html: string): VremsDocument[] {
  const docs: VremsDocument[] = []

  const links = root.querySelectorAll('a.document-link')
  for (const link of links) {
    const name = link.text.trim()

    // Try to get doc type from parent row's data attributes
    const row = link.closest('tr')
    const docType = row?.getAttribute('data-document-type')
      || row?.getAttribute('data-key')
      || ''

    // If no data attributes, infer doc type from link text
    let inferredType = docType
    if (!inferredType) {
      if (name.includes('SICPP') || name.includes('Filing Form')) {
        inferredType = 'SICPledge'
      } else if (name.includes('Filing Fee') || name.includes('Receipt')) {
        inferredType = 'FilingReceipt'
      }
    }

    if (candidateId && inferredType) {
      docs.push({
        name,
        type: inferredType,
        url: `https://vrems.scvotes.sc.gov/Candidate/ViewCandidateDocument?candidateId=${candidateId}&documentTypeSid=${inferredType}`,
      })
    } else {
      docs.push({ name, type: inferredType, url: '' })
    }
  }

  // Fallback: parse document types from the JS click handler in the page
  if (docs.length === 0 && candidateId) {
    const docTypeMatches = html.matchAll(/documentTypeSid=([^&'"]+)/g)
    for (const match of docTypeMatches) {
      const type = match[1]
      docs.push({
        name: type,
        type,
        url: `https://vrems.scvotes.sc.gov/Candidate/ViewCandidateDocument?candidateId=${candidateId}&documentTypeSid=${type}`,
      })
    }
  }

  return docs
}
