import { createHash } from 'node:crypto'

/**
 * Minimal string store used by the HTTP response cache. A shared implementation can
 * map these methods directly to Upstash Redis GET and SET PX without changing callers.
 */
export interface CacheStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string, ttlMs: number): Promise<void>
}

interface InMemoryCacheEntry {
  value: string
  expiresAt: number
}

export class InMemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, InMemoryCacheEntry>()

  constructor(private readonly now: () => number = Date.now) {}

  async get(key: string): Promise<string | undefined> {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs })
  }
}

interface CachedHttpResponse {
  status: number
  statusText: string
  headers: [string, string][]
  setCookies: string[]
  bodyBase64: string
}

export interface CachedFetchOptions {
  store: CacheStore
  ttlMs: number
  fetchImpl?: typeof globalThis.fetch
  keyPrefix?: string
}

function responseFromCache(cached: CachedHttpResponse): Response {
  const headers = new Headers(cached.headers)
  headers.delete('set-cookie')
  for (const cookie of cached.setCookies) headers.append('set-cookie', cookie)

  const body = cached.bodyBase64
    ? Buffer.from(cached.bodyBase64, 'base64')
    : null
  return new Response(body, {
    status: cached.status,
    statusText: cached.statusText,
    headers,
  })
}

async function serializeResponse(response: Response): Promise<CachedHttpResponse> {
  const clone = response.clone()
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
    setCookies: response.headers.getSetCookie?.() ?? [],
    bodyBase64: Buffer.from(await clone.arrayBuffer()).toString('base64'),
  }
}

async function cacheKey(request: Request, keyPrefix: string): Promise<string> {
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? ''
    : await request.clone().text()
  const headers = Array.from(request.headers.entries())
    .sort(([left], [right]) => left.localeCompare(right))
  const digest = createHash('sha256')
    .update(JSON.stringify({ method: request.method, url: request.url, headers, body }))
    .digest('hex')
  return `${keyPrefix}:${digest}`
}

/**
 * Caches successful GET and POST responses and coalesces identical in-flight calls.
 * POST is intentional: every upstream POST in this project is a read-only public-data
 * query. Other methods bypass the cache.
 */
export function createCachedFetch(options: CachedFetchOptions): typeof globalThis.fetch {
  const keyPrefix = options.keyPrefix ?? 'sc-elections:upstream'
  const inFlight = new Map<string, Promise<CachedHttpResponse>>()

  return async (input, init) => {
    const request = new Request(input, init)
    if (request.method !== 'GET' && request.method !== 'POST') {
      return (options.fetchImpl ?? globalThis.fetch)(request)
    }

    const key = await cacheKey(request, keyPrefix)
    const stored = await options.store.get(key)
    if (stored !== undefined) {
      return responseFromCache(JSON.parse(stored) as CachedHttpResponse)
    }

    let pending = inFlight.get(key)
    if (!pending) {
      pending = (async () => {
        const response = await (options.fetchImpl ?? globalThis.fetch)(request)
        const serialized = await serializeResponse(response)
        if (response.ok) {
          await options.store.set(key, JSON.stringify(serialized), options.ttlMs)
        }
        return serialized
      })()
      inFlight.set(key, pending)
      void pending.finally(() => inFlight.delete(key)).catch(() => undefined)
    }

    return responseFromCache(await pending)
  }
}
