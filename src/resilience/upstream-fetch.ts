import { createCachedFetch, InMemoryCacheStore, type CacheStore } from './cache.js'
import { CircuitBreaker } from './circuit-breaker.js'

// Off by default: stdio (the published npm package) must keep bare fetch semantics.
// Hosted entry points opt in via UPSTREAM_CACHE_TTL_MS, where repeat traffic from
// strangers justifies a cache and protects the upstream sites from volume.
const DEFAULT_CACHE_TTL_MS = 0
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_FAILURE_THRESHOLD = 3
const DEFAULT_CIRCUIT_RESET_MS = 60_000

export interface UpstreamFetchOptions {
  cacheStore?: CacheStore
  cacheTtlMs?: number
  timeoutMs?: number
  circuitBreaker?: CircuitBreaker
  fetchImpl?: typeof globalThis.fetch
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

/**
 * Cache is deliberately outside the circuit breaker: a target outage should stop new
 * network calls while still allowing a previously cached public record to be served.
 */
export function createUpstreamFetch(options: UpstreamFetchOptions = {}): typeof globalThis.fetch {
  const breaker = options.circuitBreaker ?? new CircuitBreaker({
    failureThreshold: positiveInteger(
      process.env.UPSTREAM_CIRCUIT_FAILURE_THRESHOLD,
      DEFAULT_FAILURE_THRESHOLD,
      'UPSTREAM_CIRCUIT_FAILURE_THRESHOLD',
    ),
    resetTimeoutMs: positiveInteger(
      process.env.UPSTREAM_CIRCUIT_RESET_MS,
      DEFAULT_CIRCUIT_RESET_MS,
      'UPSTREAM_CIRCUIT_RESET_MS',
    ),
  })

  const timeoutMs = options.timeoutMs ?? positiveInteger(
    process.env.UPSTREAM_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    'UPSTREAM_TIMEOUT_MS',
  )

  const circuitProtectedFetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString()
    const target = new URL(url).host
    return breaker.execute(
      target,
      async () => {
        // A hung upstream otherwise holds a socket on the long-running listener and
        // billable compute on serverless, with nothing to cap it.
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          return await (options.fetchImpl ?? globalThis.fetch)(input, {
            ...init,
            signal: init?.signal ?? controller.signal,
          })
        } finally {
          clearTimeout(timer)
        }
      },
      response =>
        response.status === 429 ||
        response.status === 403 ||
        response.status === 408 ||
        response.status >= 500,
    )
  }

  return createCachedFetch({
    store: options.cacheStore ?? new InMemoryCacheStore(),
    ttlMs: options.cacheTtlMs ?? positiveInteger(
      process.env.UPSTREAM_CACHE_TTL_MS,
      DEFAULT_CACHE_TTL_MS,
      'UPSTREAM_CACHE_TTL_MS',
    ),
    fetchImpl: circuitProtectedFetch,
  })
}

export const upstreamFetch = createUpstreamFetch()
