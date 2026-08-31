import { describe, expect, it, vi } from 'vitest'
import { createCachedFetch, InMemoryCacheStore } from './cache.js'

describe('createCachedFetch', () => {
  it('returns a cached response without making a second upstream call', async () => {
    const upstreamFetch = vi.fn(async () => new Response(
      JSON.stringify({ value: 'from upstream' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    const cachedFetch = createCachedFetch({
      store: new InMemoryCacheStore(),
      fetchImpl: upstreamFetch,
      ttlMs: 60_000,
    })

    const first = await cachedFetch('https://example.test/public-records', {
      method: 'POST',
      body: JSON.stringify({ candidate: 'Smith' }),
    })
    const second = await cachedFetch('https://example.test/public-records', {
      method: 'POST',
      body: JSON.stringify({ candidate: 'Smith' }),
    })

    await expect(first.json()).resolves.toEqual({ value: 'from upstream' })
    await expect(second.json()).resolves.toEqual({ value: 'from upstream' })
    expect(upstreamFetch).toHaveBeenCalledTimes(1)
  })
})
