import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpServer } from './server.js'
import { InMemoryRateLimitStore, SlidingWindowRateLimiter } from './resilience/rate-limiter.js'

const DEFAULT_RATE_LIMIT = 60
const DEFAULT_RATE_WINDOW_MS = 60_000

export interface McpHttpServerOptions {
  serverFactory?: () => McpServer
  rateLimiter?: SlidingWindowRateLimiter
  allowedOrigins?: readonly string[]
  callerId?: (request: IncomingMessage) => string
}

export interface StartMcpHttpServerOptions extends McpHttpServerOptions {
  host: string
  port: number
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function configuredOrigins(): string[] {
  return (process.env.MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
}

function normalizeOrigin(origin: string): string | undefined {
  try {
    return new URL(origin).origin
  } catch {
    return undefined
  }
}

function originAllowed(request: IncomingMessage, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.origin
  if (!origin) return true
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false
  return allowedOrigins.some(allowed => normalizeOrigin(allowed) === normalized)
}

/**
 * Rate-limit identity for the long-running listener.
 *
 * Forwarded headers are client-supplied and trusting them by default lets a caller
 * send a fresh `X-Forwarded-For` per request: that both bypasses the rate limit and
 * grows the limiter's key map without bound. So the socket address wins unless the
 * operator opts in by setting MCP_TRUST_PROXY_HEADERS=1, which is only correct when
 * a trusted proxy overwrites those headers.
 */
function defaultCallerId(request: IncomingMessage): string {
  const socketAddress = request.socket.remoteAddress

  if (process.env.MCP_TRUST_PROXY_HEADERS === '1') {
    const forwarded = request.headers['x-forwarded-for']
    const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded
    const proxyAddress = forwardedValue?.split(',')[0]?.trim()
    const cloudflareAddress = request.headers['cf-connecting-ip']
    const cloudflareValue = Array.isArray(cloudflareAddress) ? cloudflareAddress[0] : cloudflareAddress
    return proxyAddress || cloudflareValue || socketAddress || 'unknown'
  }

  return socketAddress || 'unknown'
}

function writeJsonRpcError(
  response: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  }))
}

export function createMcpHttpServer(options: McpHttpServerOptions = {}): Server {
  const serverFactory = options.serverFactory ?? createMcpServer
  const allowedOrigins = options.allowedOrigins ?? configuredOrigins()
  const callerId = options.callerId ?? defaultCallerId
  const rateLimiter = options.rateLimiter ?? new SlidingWindowRateLimiter({
    store: new InMemoryRateLimitStore(),
    limit: positiveInteger(process.env.MCP_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT, 'MCP_RATE_LIMIT_MAX'),
    windowMs: positiveInteger(process.env.MCP_RATE_LIMIT_WINDOW_MS, DEFAULT_RATE_WINDOW_MS, 'MCP_RATE_LIMIT_WINDOW_MS'),
  })

  return createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://localhost').pathname
      if (path !== '/mcp') {
        writeJsonRpcError(response, 404, -32001, 'Not found')
        return
      }

      if (!originAllowed(request, allowedOrigins)) {
        writeJsonRpcError(response, 403, -32000, 'Origin not allowed')
        return
      }

      const rateLimit = await rateLimiter.check(callerId(request))
      response.setHeader('X-RateLimit-Limit', rateLimit.limit)
      response.setHeader('X-RateLimit-Remaining', rateLimit.remaining)
      if (!rateLimit.allowed) {
        response.setHeader('Retry-After', Math.ceil(rateLimit.retryAfterMs / 1000))
        writeJsonRpcError(response, 429, -32000, 'Rate limit exceeded')
        return
      }

      const mcpServer = serverFactory()
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })

      try {
        await mcpServer.connect(transport)
        await transport.handleRequest(request, response)
      } catch (error) {
        console.error('HTTP MCP request failed:', error)
        if (!response.headersSent) {
          writeJsonRpcError(response, 500, -32603, 'Internal server error')
        } else if (!response.writableEnded) {
          response.end()
        }
      } finally {
        await mcpServer.close().catch(error => {
          console.error('HTTP MCP cleanup failed:', error)
        })
      }
    })().catch(error => {
      console.error('HTTP request handling failed:', error)
      if (!response.headersSent) {
        writeJsonRpcError(response, 500, -32603, 'Internal server error')
      } else if (!response.writableEnded) {
        response.end()
      }
    })
  })
}

export async function startMcpHttpServer(options: StartMcpHttpServerOptions): Promise<Server> {
  const server = createMcpHttpServer(options)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, resolve)
  })
  return server
}
