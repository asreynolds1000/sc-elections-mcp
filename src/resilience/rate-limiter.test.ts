import { describe, expect, it } from 'vitest'
import { InMemoryRateLimitStore, SlidingWindowRateLimiter } from './rate-limiter.js'

describe('SlidingWindowRateLimiter', () => {
  it('rejects a caller after the configured threshold', async () => {
    const limiter = new SlidingWindowRateLimiter({
      store: new InMemoryRateLimitStore(),
      limit: 2,
      windowMs: 60_000,
      now: () => 1_000,
    })

    await expect(limiter.check('caller-a')).resolves.toMatchObject({ allowed: true, remaining: 1 })
    await expect(limiter.check('caller-a')).resolves.toMatchObject({ allowed: true, remaining: 0 })
    await expect(limiter.check('caller-a')).resolves.toMatchObject({ allowed: false, remaining: 0 })
  })
})
