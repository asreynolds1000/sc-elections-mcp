import { describe, it, expect } from 'vitest'
import { createMcpFetchHandler } from '../src/serverless-handler.js'

const TOKEN = 'test-token-abcdefghijklmnop'

function initRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.test/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1.0' } },
    }),
  })
}

describe('shared-secret access token', () => {
  it('rejects a request with no token when one is configured', async () => {
    const handler = createMcpFetchHandler({ accessToken: TOKEN })
    const res = await handler(initRequest())
    expect(res.status).toBe(401)
  })

  it('rejects a wrong token', async () => {
    const handler = createMcpFetchHandler({ accessToken: TOKEN })
    const res = await handler(initRequest({ authorization: 'Bearer wrong-token-aaaaaaaaaaa' }))
    expect(res.status).toBe(401)
  })

  it('accepts the correct token as a Bearer header', async () => {
    const handler = createMcpFetchHandler({ accessToken: TOKEN })
    const res = await handler(initRequest({ authorization: `Bearer ${TOKEN}` }))
    expect(res.status).toBe(200)
  })

  it('accepts the correct token as X-MCP-Token', async () => {
    const handler = createMcpFetchHandler({ accessToken: TOKEN })
    const res = await handler(initRequest({ 'x-mcp-token': TOKEN }))
    expect(res.status).toBe(200)
  })

  it('stays open when no token is configured, so local use is unaffected', async () => {
    const handler = createMcpFetchHandler({ accessToken: undefined })
    const res = await handler(initRequest())
    expect(res.status).toBe(200)
  })
})

describe('token header shapes a real client might send', () => {
  it('accepts a bare token in Authorization, without the Bearer prefix', async () => {
    const handler = createMcpFetchHandler({ accessToken: TOKEN })
    const res = await handler(initRequest({ authorization: TOKEN }))
    expect(res.status).toBe(200)
  })

  it('tolerates surrounding whitespace', async () => {
    const handler = createMcpFetchHandler({ accessToken: TOKEN })
    const res = await handler(initRequest({ authorization: `  Bearer   ${TOKEN}  ` }))
    expect(res.status).toBe(200)
  })
})
