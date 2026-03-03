import type { VremsCandidate } from '../types.js'

/**
 * Parse a CSV line handling quoted fields with embedded commas.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  let i = 0

  while (i < line.length) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          // RFC 4180: "" inside quoted field = literal "
          current += '"'
          i += 2
          continue
        }
        // End of quoted field
        inQuotes = false
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(current.trim())
      current = ''
    } else {
      current += ch
    }
    i++
  }
  fields.push(current.trim())
  return fields
}

/**
 * Parse the 25-column CSV export from VREMS ExportSearchResults.
 */
export function parseCsvExport(csv: string): VremsCandidate[] {
  const lines = csv.split('\n')
  if (lines.length < 2) return []

  // Skip header row
  return lines.slice(1)
    .filter(line => line.trim())
    .map(line => {
      const f = parseCsvLine(line)
      return {
        ballotSortOrder: f[0] || '',
        filingLevel: f[1] || '',
        electionName: f[2] || '',
        office: f[3] || '',
        district: f[4] || '',
        counties: f[5] || '',
        ballotFirstMiddle: f[6] || '',
        ballotLastSuffix: f[7] || '',
        runningMate: f[8] || '',
        firstName: f[9] || '',
        middleName: f[10] || '',
        lastName: f[11] || '',
        suffix: f[12] || '',
        party: f[13] || '',
        filingLocation: f[14] || '',
        dateFiled: f[15] || '',
        timeFiled: f[16] || '',
        filingFee: f[17] || '',
        status: f[18] || '',
        statusDate: f[19] || '',
        address: f[20] || '',
        phone: f[21] || '',
        email: f[22] || '',
        runningMateOffice: f[23] || '',
      }
    })
}
