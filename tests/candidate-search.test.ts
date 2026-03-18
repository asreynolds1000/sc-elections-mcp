import { describe, it, expect } from 'vitest'
import { parseSearchHtml } from '../src/parsers/candidate-search.js'

function makeTableHtml(runningMateCell: string): string {
  return `
    <table id="gridCandidateSearch">
      <tbody>
        <tr>
          <td>County Council District 23</td>
          <td>Greenville</td>
          <td><a href="CandidateDetail/?candidateId=99&electionId=22596&searchType=Default">Smith, Jane</a></td>
          <td>${runningMateCell}</td>
          <td>Republican</td>
          <td>Greenville County</td>
          <td>Active</td>
        </tr>
      </tbody>
    </table>
  `
}

describe('parseSearchHtml', () => {
  it('normalizes "Not Designated" runningMate to empty string', () => {
    const result = parseSearchHtml(makeTableHtml('Not Designated'))
    expect(result).toHaveLength(1)
    expect(result[0].runningMate).toBe('')
  })

  it('preserves actual running mate name', () => {
    const result = parseSearchHtml(makeTableHtml('Jones, Bob'))
    expect(result[0].runningMate).toBe('Jones, Bob')
  })

  it('handles empty cell for running mate', () => {
    const result = parseSearchHtml(makeTableHtml(''))
    expect(result[0].runningMate).toBe('')
  })

  it('parses candidateId and electionId from href', () => {
    const result = parseSearchHtml(makeTableHtml(''))
    expect(result[0].candidateId).toBe('99')
    expect(result[0].electionId).toBe('22596')
  })
})
