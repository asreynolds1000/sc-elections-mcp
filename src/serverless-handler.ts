import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { createMcpServer } from './server.js'
import { InMemoryRateLimitStore, SlidingWindowRateLimiter } from './resilience/rate-limiter.js'

const DEFAULT_RATE_LIMIT = 60
const DEFAULT_RATE_WINDOW_MS = 60_000

export interface McpFetchHandlerOptions {
  serverFactory?: () => McpServer
  rateLimiter?: SlidingWindowRateLimiter
  allowedOrigins?: readonly string[]
  callerId?: (request: Request) => string
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

function originAllowed(request: Request, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false
  return allowedOrigins.some(allowed => normalizeOrigin(allowed) === normalized)
}

function defaultCallerId(request: Request): string {
  const forwarded = request.headers.get('x-vercel-forwarded-for')
    ?? request.headers.get('x-forwarded-for')
    ?? request.headers.get('cf-connecting-ip')
  return forwarded?.split(',')[0]?.trim() || 'unknown'
}

function jsonRpcError(status: number, code: number, message: string, headers?: HeadersInit): Response {
  return Response.json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  }, { status, headers })
}

function withRateLimitHeaders(
  response: Response,
  rateLimit: Awaited<ReturnType<SlidingWindowRateLimiter['check']>>,
): Response {
  const headers = new Headers(response.headers)
  headers.set('X-RateLimit-Limit', String(rateLimit.limit))
  headers.set('X-RateLimit-Remaining', String(rateLimit.remaining))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Create a Vercel/fetch-compatible stateless MCP handler. The handler owns one
 * per-instance rate limiter, but creates a fresh MCP server and transport for every
 * invocation as required by SDK 1.27.1's stateless transport.
 */
export function createMcpFetchHandler(
  options: McpFetchHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const serverFactory = options.serverFactory ?? createMcpServer
  const allowedOrigins = options.allowedOrigins ?? configuredOrigins()
  const callerId = options.callerId ?? defaultCallerId
  const rateLimiter = options.rateLimiter ?? new SlidingWindowRateLimiter({
    store: new InMemoryRateLimitStore(),
    limit: positiveInteger(process.env.MCP_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT, 'MCP_RATE_LIMIT_MAX'),
    windowMs: positiveInteger(
      process.env.MCP_RATE_LIMIT_WINDOW_MS,
      DEFAULT_RATE_WINDOW_MS,
      'MCP_RATE_LIMIT_WINDOW_MS',
    ),
  })

  return async (request: Request): Promise<Response> => {
    if (!originAllowed(request, allowedOrigins)) {
      return jsonRpcError(403, -32000, 'Origin not allowed')
    }

    const rateLimit = await rateLimiter.check(callerId(request))
    if (!rateLimit.allowed) {
      return jsonRpcError(429, -32000, 'Rate limit exceeded', {
        'Retry-After': String(Math.ceil(rateLimit.retryAfterMs / 1000)),
        'X-RateLimit-Limit': String(rateLimit.limit),
        'X-RateLimit-Remaining': String(rateLimit.remaining),
      })
    }

    if (request.method !== 'POST') {
      return withRateLimitHeaders(jsonRpcError(405, -32000, 'Method not allowed', {
        Allow: 'POST',
      }), rateLimit)
    }

    let mcpServer: McpServer | undefined
    try {
      mcpServer = serverFactory()
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      await mcpServer.connect(transport)
      return withRateLimitHeaders(await transport.handleRequest(request), rateLimit)
    } catch (error) {
      console.error('Serverless MCP request failed:', error)
      return withRateLimitHeaders(jsonRpcError(500, -32603, 'Internal server error'), rateLimit)
    } finally {
      await mcpServer?.close().catch(error => {
        console.error('Serverless MCP cleanup failed:', error)
      })
    }
  }
}

