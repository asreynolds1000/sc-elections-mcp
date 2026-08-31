import { describe, it, expect, vi } from 'vitest'
import { createUpstreamFetch } from './upstream-fetch.js'
import { CircuitOpenError } from './circuit-breaker.js'

function jsonResponse(status: number): Response {
  return new Response(JSON.stringify({ status }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('upstream hardening', () => {
  it('opens the circuit on repeated 403s, not just 429/5xx', async () => {
    // A government WAF soft-ban returns 403. The breaker previously ignored it,
    // so it was blind to the exact case it exists to catch and kept hammering.
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return jsonResponse(403)
    }) as unknown as typeof globalThis.fetch

    const f = createUpstreamFetch({ fetchImpl, cacheTtlMs: 0 })
    for (let i = 0; i < 3; i++) {
      await f('https://ethicsfiling.sc.gov/x').catch(() => undefined)
    }
    const callsBefore = calls

    await expect(f('https://ethicsfiling.sc.gov/x')).rejects.toBeInstanceOf(CircuitOpenError)
    expect(calls).toBe(callsBefore) // breaker short-circuited, no further upstream hit
  })

  it('does not cache by default, so stdio keeps bare fetch semantics', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return jsonResponse(200)
    }) as unknown as typeof globalThis.fetch

    const f = createUpstreamFetch({ fetchImpl })
    await f('https://ethicsfiling.sc.gov/same')
    await f('https://ethicsfiling.sc.gov/same')
    expect(calls).toBe(2)
  })

  it('caches when a hosted entry point opts in', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return jsonResponse(200)
    }) as unknown as typeof globalThis.fetch

    const f = createUpstreamFetch({ fetchImpl, cacheTtlMs: 60_000 })
    await f('https://ethicsfiling.sc.gov/same')
    await f('https://ethicsfiling.sc.gov/same')
    expect(calls).toBe(1)
  })

  it('aborts an upstream request that exceeds the timeout', async () => {
    const fetchImpl = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })) as unknown as typeof globalThis.fetch

    const f = createUpstreamFetch({ fetchImpl, cacheTtlMs: 0, timeoutMs: 25 })
    await expect(f('https://ethicsfiling.sc.gov/hangs')).rejects.toThrow()
  })
})

describe('upstream hardening: defects found in review', () => {
  it('retains nothing when caching is disabled', async () => {
    // The previous "cache off" fix set ttl to 0 but still serialized and stored every
    // body. Entries were already expired, so unservable, and only removed by a get()
    // of the same key. Measured 29MB retained over 200 distinct 100KB responses.
    const big = 'x'.repeat(100_000)
    const fetchImpl = (async () => new Response(big, { status: 200 })) as unknown as typeof globalThis.fetch
    const store = new (await import('./cache.js')).InMemoryCacheStore()
    const f = createUpstreamFetch({ fetchImpl, cacheStore: store })

    for (let i = 0; i < 25; i++) await f('https://ethicsfiling.sc.gov/q' + i)
    expect((store as unknown as { entries: Map<string, unknown> }).entries.size).toBe(0)
  })

  it('does not cache a 200 that carries GraphQL errors', async () => {
    // election-history returns HTTP 200 with a top-level `errors` array and the client
    // rejects it. Caching that replayed one transient failure for the whole TTL.
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      const body = calls === 1
        ? JSON.stringify({ errors: [{ message: 'transient' }] })
        : JSON.stringify({ data: { ok: true } })
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof globalThis.fetch

    const f = createUpstreamFetch({ fetchImpl, cacheTtlMs: 60_000 })
    await f('https://electionhistory.scvotes.gov/graphql', { method: 'POST' })
    const second = await f('https://electionhistory.scvotes.gov/graphql', { method: 'POST' })

    expect(calls).toBe(2) // the error was not cached and replayed
    expect(await second.json()).toEqual({ data: { ok: true } })
  })

  it("composes the caller's abort signal with the timeout instead of replacing it", async () => {
    // The timeout wrapper passed `init?.signal ?? controller.signal`, but the cache
    // layer calls fetchImpl(request) with no init, so the caller's signal (carried on
    // the Request) was always discarded. sweepAllFilers' 10s cap became inert.
    let seenAborted = false
    const fetchImpl = ((input: Request | string | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const sig = init?.signal ?? (input instanceof Request ? input.signal : undefined)
        // The abort may already have fired before this mock is reached, because the
        // cache layer hashes the request key asynchronously first.
        if (sig?.aborted) {
          seenAborted = true
          reject(new Error('aborted'))
          return
        }
        sig?.addEventListener('abort', () => {
          seenAborted = true
          reject(new Error('aborted'))
        })
      })) as unknown as typeof globalThis.fetch

    const callerController = new AbortController()
    const f = createUpstreamFetch({ fetchImpl, cacheTtlMs: 0, timeoutMs: 60_000 })
    const inflight = f(new Request('https://ethicsfiling.sc.gov/slow', { signal: callerController.signal }))
    callerController.abort() // caller aborts well before the 60s timeout
    await expect(inflight).rejects.toThrow()
    expect(seenAborted).toBe(true)
  })
})
