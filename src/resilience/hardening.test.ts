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
