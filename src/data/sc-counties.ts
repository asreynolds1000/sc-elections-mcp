/**
 * SC county codes, city-to-county mappings, and resolution helpers.
 *
 * County codes from VREMS API (hars/vrems-api-analysis.md lines 414-432).
 * City-to-county mappings from SC Secretary of State municipal list + US Census designated places.
 */

// VREMS county codes (zero-padded 2-digit strings)
export const SC_COUNTY_CODES: Record<string, string> = {
  '01': 'Abbeville',
  '02': 'Aiken',
  '03': 'Allendale',
  '04': 'Anderson',
  '05': 'Bamberg',
  '06': 'Barnwell',
  '07': 'Beaufort',
  '08': 'Berkeley',
  '09': 'Calhoun',
  '10': 'Charleston',
  '11': 'Cherokee',
  '12': 'Chester',
  '13': 'Chesterfield',
  '14': 'Clarendon',
  '15': 'Colleton',
  '16': 'Darlington',
  '17': 'Dillon',
  '18': 'Dorchester',
  '19': 'Edgefield',
  '20': 'Fairfield',
  '21': 'Florence',
  '22': 'Georgetown',
  '23': 'Greenville',
  '24': 'Greenwood',
  '25': 'Hampton',
  '26': 'Horry',
  '27': 'Jasper',
  '28': 'Kershaw',
  '29': 'Lancaster',
  '30': 'Laurens',
  '31': 'Lee',
  '32': 'Lexington',
  '33': 'McCormick',
  '34': 'Marion',
  '35': 'Marlboro',
  '36': 'Newberry',
  '37': 'Oconee',
  '38': 'Orangeburg',
  '39': 'Pickens',
  '40': 'Richland',
  '41': 'Saluda',
  '42': 'Spartanburg',
  '43': 'Sumter',
  '44': 'Union',
  '45': 'Williamsburg',
  '46': 'York',
}

// Reverse lookup: lowercase county name → code
export const SC_COUNTY_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(SC_COUNTY_CODES).map(([code, name]) => [name.toLowerCase(), code]),
)

// All 46 county names for regex matching (sorted longest-first to prefer "Mc Cormick" over partial matches)
const COUNTY_NAMES_SORTED = Object.values(SC_COUNTY_CODES).sort((a, b) => b.length - a.length)

/**
 * City/town → county mapping for SC.
 * Covers all incorporated municipalities plus major unincorporated communities
 * for Greenville, Spartanburg, Laurens, and Greenwood counties.
 *
 * Source: SC Secretary of State municipal list + US Census designated places (2020).
 */
export const SC_CITY_TO_COUNTY: Record<string, string> = {
  // Abbeville County
  'abbeville': 'Abbeville',
  'calhoun falls': 'Abbeville',
  'donalds': 'Abbeville',
  'due west': 'Abbeville',
  'lowndesville': 'Abbeville',
  // Aiken County
  'aiken': 'Aiken',
  'burnettown': 'Aiken',
  'jackson': 'Aiken',
  'new ellenton': 'Aiken',
  'north augusta': 'Aiken',
  'perry': 'Aiken',
  'salley': 'Aiken',
  'wagener': 'Aiken',
  'windsor': 'Aiken',
  // Allendale County
  'allendale': 'Allendale',
  'fairfax': 'Allendale',
  'ulmer': 'Allendale',
  // Anderson County
  'anderson': 'Anderson',
  'belton': 'Anderson',
  'honea path': 'Anderson',
  'iva': 'Anderson',
  'pelzer': 'Anderson',
  'pendleton': 'Anderson',
  'starr': 'Anderson',
  'west pelzer': 'Anderson',
  'williamston': 'Anderson',
  'powdersville': 'Anderson',
  'piedmont': 'Anderson', // splits Anderson/Greenville — primary is Anderson
  // Bamberg County
  'bamberg': 'Bamberg',
  'denmark': 'Bamberg',
  'ehrhardt': 'Bamberg',
  'govan': 'Bamberg',
  'olar': 'Bamberg',
  // Barnwell County
  'barnwell': 'Barnwell',
  'blackville': 'Barnwell',
  'elko': 'Barnwell',
  'williston': 'Barnwell',
  // Beaufort County
  'beaufort': 'Beaufort',
  'bluffton': 'Beaufort',
  'hilton head island': 'Beaufort',
  'hilton head': 'Beaufort',
  'port royal': 'Beaufort',
  'st. helena': 'Beaufort',
  // Berkeley County
  'goose creek': 'Berkeley',
  'hanahan': 'Berkeley',
  'moncks corner': 'Berkeley',
  'bonneau': 'Berkeley',
  'jamestown': 'Berkeley',
  'st. stephen': 'Berkeley',
  // Calhoun County
  'cameron': 'Calhoun',
  'st. matthews': 'Calhoun',
  'saint matthews': 'Calhoun',
  // Charleston County
  'charleston': 'Charleston',
  'folly beach': 'Charleston',
  'isle of palms': 'Charleston',
  'kiawah island': 'Charleston',
  'mount pleasant': 'Charleston',
  'mt. pleasant': 'Charleston',
  'north charleston': 'Charleston',
  "sullivan's island": 'Charleston',
  'sullivans island': 'Charleston',
  'james island': 'Charleston',
  'johns island': 'Charleston',
  'daniel island': 'Charleston',
  // Cherokee County
  'gaffney': 'Cherokee',
  'blacksburg': 'Cherokee',
  'chesnee': 'Cherokee', // splits Cherokee/Spartanburg — primary Cherokee
  // Chester County
  'chester': 'Chester',
  'fort lawn': 'Chester',
  'great falls': 'Chester',
  'richburg': 'Chester',
  // Chesterfield County
  'cheraw': 'Chesterfield',
  'chesterfield': 'Chesterfield',
  'mcbee': 'Chesterfield',
  'pageland': 'Chesterfield',
  'patrick': 'Chesterfield',
  // Clarendon County
  'manning': 'Clarendon',
  'summerton': 'Clarendon',
  'turbeville': 'Clarendon',
  'greeleyville': 'Clarendon',
  // Colleton County
  'walterboro': 'Colleton',
  'cottageville': 'Colleton',
  'edisto beach': 'Colleton',
  // Darlington County
  'darlington': 'Darlington',
  'hartsville': 'Darlington',
  'lamar': 'Darlington',
  'society hill': 'Darlington',
  // Dillon County
  'dillon': 'Dillon',
  'lake view': 'Dillon',
  'latta': 'Dillon',
  // mullins is in Marion County, listed there
  // Dorchester County
  'summerville': 'Dorchester',
  'ridgeville': 'Dorchester',
  'st. george': 'Dorchester',
  'harleyville': 'Dorchester',
  'reevesville': 'Dorchester',
  // Edgefield County
  'edgefield': 'Edgefield',
  'johnston': 'Edgefield',
  'trenton': 'Edgefield',
  // Fairfield County
  'winnsboro': 'Fairfield',
  'ridgeway': 'Fairfield',
  // Florence County
  'florence': 'Florence',
  'lake city': 'Florence',
  'johnsonville': 'Florence',
  'pamplico': 'Florence',
  'timmonsville': 'Florence',
  'coward': 'Florence',
  // Georgetown County
  'georgetown': 'Georgetown',
  'andrews': 'Georgetown',
  'pawleys island': 'Georgetown',
  // Greenville County (expanded — includes major unincorporated communities)
  'greenville': 'Greenville',
  'fountain inn': 'Greenville',
  'greer': 'Greenville',
  'mauldin': 'Greenville',
  'simpsonville': 'Greenville',
  'travelers rest': 'Greenville',
  'taylors': 'Greenville',
  'berea': 'Greenville',
  'five forks': 'Greenville',
  'gantt': 'Greenville',
  'wade hampton': 'Greenville',
  'sans souci': 'Greenville',
  'welcome': 'Greenville',
  'dunean': 'Greenville',
  'tigerville': 'Greenville',
  'marietta': 'Greenville',
  // reidville is in Spartanburg County, listed there
  // Greenwood County (expanded)
  'greenwood': 'Greenwood',
  'hodges': 'Greenwood',
  'ninety six': 'Greenwood',
  'troy': 'Greenwood',
  'ware shoals': 'Greenwood',
  'coronaca': 'Greenwood',
  // Hampton County
  'hampton': 'Hampton',
  'estill': 'Hampton',
  'varnville': 'Hampton',
  'early branch': 'Hampton',
  // Horry County
  'conway': 'Horry',
  'myrtle beach': 'Horry',
  'north myrtle beach': 'Horry',
  'loris': 'Horry',
  'surfside beach': 'Horry',
  'garden city': 'Horry',
  'little river': 'Horry',
  'aynor': 'Horry',
  // Jasper County
  'hardeeville': 'Jasper',
  'ridgeland': 'Jasper',
  // Kershaw County
  'camden': 'Kershaw',
  'elgin': 'Kershaw',
  'lugoff': 'Kershaw',
  'bethune': 'Kershaw',
  // Lancaster County
  'lancaster': 'Lancaster',
  'heath springs': 'Lancaster',
  'indian land': 'Lancaster',
  'kershaw': 'Lancaster',
  // Laurens County (expanded)
  'laurens': 'Laurens',
  'clinton': 'Laurens',
  'cross hill': 'Laurens',
  'gray court': 'Laurens',
  'joanna': 'Laurens',
  'waterloo': 'Laurens',
  // Lee County
  'bishopville': 'Lee',
  // Lexington County
  'lexington': 'Lexington',
  'batesburg-leesville': 'Lexington',
  'batesburg': 'Lexington',
  'leesville': 'Lexington',
  'cayce': 'Lexington',
  'chapin': 'Lexington',
  'gilbert': 'Lexington',
  'irmo': 'Lexington',
  'pelion': 'Lexington',
  'pine ridge': 'Lexington',
  'south congaree': 'Lexington',
  'springdale': 'Lexington',
  'swansea': 'Lexington',
  'west columbia': 'Lexington',
  // McCormick County
  'mccormick': 'McCormick',
  'mc cormick': 'McCormick',
  'plum branch': 'McCormick',
  // Marion County
  'marion': 'Marion',
  'mullins': 'Marion',
  // Marlboro County
  'bennettsville': 'Marlboro',
  'clio': 'Marlboro',
  'mccoll': 'Marlboro',
  // Newberry County
  'newberry': 'Newberry',
  'prosperity': 'Newberry',
  'silverstreet': 'Newberry',
  'whitmire': 'Newberry',
  'pomaria': 'Newberry',
  'little mountain': 'Newberry',
  // Oconee County
  'seneca': 'Oconee',
  'walhalla': 'Oconee',
  'westminster': 'Oconee',
  'salem': 'Oconee',
  'west union': 'Oconee',
  // Orangeburg County
  'orangeburg': 'Orangeburg',
  'branchville': 'Orangeburg',
  'elloree': 'Orangeburg',
  'holly hill': 'Orangeburg',
  'north': 'Orangeburg',
  'santee': 'Orangeburg',
  'bowman': 'Orangeburg',
  'rowesville': 'Orangeburg',
  // Pickens County
  'easley': 'Pickens',
  'pickens': 'Pickens',
  'central': 'Pickens',
  'clemson': 'Pickens',
  'liberty': 'Pickens',
  'norris': 'Pickens',
  'six mile': 'Pickens',
  // Richland County
  'columbia': 'Richland',
  'blythewood': 'Richland',
  'eastover': 'Richland',
  'forest acres': 'Richland',
  'arcadia lakes': 'Richland',
  'hopkins': 'Richland',
  // Saluda County
  'saluda': 'Saluda',
  'ridge spring': 'Saluda',
  'ward': 'Saluda',
  // Spartanburg County (expanded)
  'spartanburg': 'Spartanburg',
  'boiling springs': 'Spartanburg',
  'campobello': 'Spartanburg',
  'cowpens': 'Spartanburg',
  'duncan': 'Spartanburg',
  'inman': 'Spartanburg',
  'landrum': 'Spartanburg',
  'lyman': 'Spartanburg',
  'moore': 'Spartanburg',
  'pacolet': 'Spartanburg',
  'roebuck': 'Spartanburg',
  'wellford': 'Spartanburg',
  'woodruff': 'Spartanburg',
  'pauline': 'Spartanburg',
  'reidville': 'Spartanburg',
  'buffalo': 'Spartanburg', // Note: also Union — primary Spartanburg
  // Sumter County
  'sumter': 'Sumter',
  'mayesville': 'Sumter',
  'pinewood': 'Sumter',
  // Union County
  'union': 'Union',
  'jonesville': 'Union',
  'lockhart': 'Union',
  // Williamsburg County
  'hemingway': 'Williamsburg',
  'kingstree': 'Williamsburg',
  'lane': 'Williamsburg',
  // York County
  'rock hill': 'York',
  'clover': 'York',
  'fort mill': 'York',
  'tega cay': 'York',
  'york': 'York',
  'lake wylie': 'York',
  'mcconnells': 'York',
}

/**
 * Resolve a county name or code to a VREMS county code.
 * Accepts "Greenville", "greenville", or "23". Returns undefined for unrecognized input.
 */
export function resolveCountyCode(input: string): string | undefined {
  const trimmed = input.trim()
  // Already a code?
  if (/^\d{1,2}$/.test(trimmed)) {
    const padded = trimmed.padStart(2, '0')
    return SC_COUNTY_CODES[padded] ? padded : undefined
  }
  return SC_COUNTY_NAMES[trimmed.toLowerCase()]
}

/**
 * Resolve a county name or code to a county name.
 * Accepts "Greenville", "greenville", or "23". Returns undefined for unrecognized input.
 */
export function resolveCountyName(input: string): string | undefined {
  const trimmed = input.trim()
  if (/^\d{1,2}$/.test(trimmed)) {
    return SC_COUNTY_CODES[trimmed.padStart(2, '0')]
  }
  const code = SC_COUNTY_NAMES[trimmed.toLowerCase()]
  return code ? SC_COUNTY_CODES[code] : undefined
}

/**
 * Extract county from an Ethics API filer address.
 *
 * Addresses follow the pattern: "{street} {city}, SC {zip}"
 * Examples:
 *   "1629 Bypass 72 Ne Greenwood, SC 29649"
 *   "4303 Old Buncombe Rd, Greenville, SC 29617"
 *   "Po Box 22 Reidville, SC 29375"
 *   "709 Southern Street Spartanburg, SC 29303"
 *
 * Returns the county name or undefined if city not in mapping.
 */
export function extractCountyFromAddress(address: string): string | undefined {
  if (!address) return undefined

  // Find ", SC {zip}" and extract everything before it
  const scMatch = address.match(/^(.+?)\s*,\s*SC\s+\d{5}/i)
  if (!scMatch) return undefined

  const beforeSC = scMatch[1].trim()

  // Split into words and try progressively longer city names from the end
  // (handles "North Augusta", "Boiling Springs", "Hilton Head Island", etc.)
  // Also handle optional comma before city: "4303 Old Buncombe Rd, Greenville"
  const cleaned = beforeSC.replace(/,\s*$/, '').replace(/.*,\s*/, '')  // take text after last comma if any
  const words = cleaned.split(/\s+/)

  for (let len = Math.min(words.length, 4); len >= 1; len--) {
    const candidate = words.slice(words.length - len).join(' ').toLowerCase()
    if (SC_CITY_TO_COUNTY[candidate]) return SC_CITY_TO_COUNTY[candidate]
  }

  // Fallback: try the full cleaned string
  const full = cleaned.toLowerCase()
  return SC_CITY_TO_COUNTY[full]
}

/**
 * Extract county from an Ethics Commission office name string.
 *
 * Uses word-boundary matching to find any of the 46 SC county names.
 * Returns the first match, or undefined.
 */
export function extractCountyFromOfficeName(officeName: string): string | undefined {
  if (!officeName) return undefined
  const lower = officeName.toLowerCase()
  for (const county of COUNTY_NAMES_SORTED) {
    const pattern = new RegExp(`\\b${county.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
    if (pattern.test(lower)) return county
  }
  return undefined
}
