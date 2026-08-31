import { describe, expect, it } from 'vitest'
import { selectTransportMode } from './transport-mode.js'

describe('selectTransportMode', () => {
  it('keeps stdio as the default', () => {
    expect(selectTransportMode([], {})).toBe('stdio')
  })

  it('enables HTTP with a CLI flag or environment variable', () => {
    expect(selectTransportMode(['--http'], {})).toBe('http')
    expect(selectTransportMode([], { MCP_TRANSPORT: 'http' })).toBe('http')
  })
})
