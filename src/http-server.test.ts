import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpHttpServer } from './http-server.js'

const openServers: Server[] = []
const httpFetch = globalThis.fetch.bind(globalThis)

async function startServer(): Promise<string> {
  const server = createMcpHttpServer()
  openServers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}/mcp`
}

async function postMcp(endpoint: string, body: Record<string, unknown>) {
  return httpFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
    },
    body: JSON.stringify(body),
  })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(openServers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })))
})

describe('Streamable HTTP transport', () => {
  it('responds to an MCP initialize request', async () => {
    const endpoint = await startServer()
    const response = await postMcp(endpoint, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'vitest', version: '1.0.0' },
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        serverInfo: { name: 'sc-elections-mcp' },
        capabilities: { tools: {} },
      },
    })
  })

  it('runs a registered tool over HTTP', async () => {
    const upstreamFetch = vi.fn(async () => new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', upstreamFetch)
    const endpoint = await startServer()
    const response = await postMcp(endpoint, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'search_expenditures',
        arguments: { vendor_name: 'Mock Vendor' },
      },
    })

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
