import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import mcpRoute from '../api/mcp.js'

function mcpRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Vercel MCP function route', () => {
  it('responds to an MCP initialize request', async () => {
    const response = await mcpRoute.fetch(mcpRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '1.0.0' },
      },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-11-25',
        serverInfo: { name: 'sc-elections-mcp' },
        capabilities: { tools: {} },
      },
    })
  })

  it('runs a registered tool without a live upstream request', async () => {
    const upstreamFetch = vi.fn(async () => new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', upstreamFetch)

    const response = await mcpRoute.fetch(mcpRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'search_expenditures',
        arguments: { vendor_name: 'Serverless Route Test Vendor' },
      },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        content: [{ type: 'text', text: 'No expenditures found matching filters' }],
      },
    })
    expect(upstreamFetch).toHaveBeenCalledTimes(1)
  })
})

describe('published stdio entry point', () => {
  it('still starts in stdio mode by default', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'src/index.ts'],
      cwd: process.cwd(),
      stderr: 'pipe',
    })
    const client = new Client({ name: 'stdio-regression-test', version: '1.0.0' })

    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      expect(tools.map(tool => tool.name)).toContain('search_expenditures')
    } finally {
      await client.close()
    }
  })
})
