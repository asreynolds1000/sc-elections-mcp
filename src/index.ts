#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { startMcpHttpServer } from './http-server.js'
import { createMcpServer } from './server.js'
import { selectTransportMode } from './transport-mode.js'

async function main() {
  if (selectTransportMode() === 'http') {
    const host = process.env.MCP_HOST ?? process.env.HOST ?? '127.0.0.1'
    const portValue = process.env.MCP_PORT ?? process.env.PORT ?? '3000'
    const port = Number(portValue)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error('MCP_PORT/PORT must be an integer between 1 and 65535')
    }
    await startMcpHttpServer({ host, port })
    console.error(`sc-elections-mcp listening on http://${host}:${port}/mcp`)
    return
  }

  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
