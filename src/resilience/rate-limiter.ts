export interface RateLimitStoreResult {
  count: number
  resetAt: number
}

/**
 * The operation must be atomic in a shared implementation. An Upstash-backed store
 * can implement this with a sorted set plus a Lua script or transaction.
 */
export interface RateLimitStore {
  consume(key: string, now: number, windowMs: number, limit: number): Promise<RateLimitStoreResult>
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly timestamps = new Map<string, number[]>()

  async consume(key: string, now: number, windowMs: number, limit: number): Promise<RateLimitStoreResult> {
    const windowStart = now - windowMs
    const active = (this.timestamps.get(key) ?? []).filter(timestamp => timestamp > windowStart)

    if (active.length >= limit) {
      this.timestamps.set(key, active)
      return { count: active.length + 1, resetAt: active[0] + windowMs }
    }

    active.push(now)
    this.timestamps.set(key, active)
    return { count: active.length, resetAt: active[0] + windowMs }
  }
}

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterMs: number
}

export interface SlidingWindowRateLimiterOptions {
  store: RateLimitStore
  limit: number
  windowMs: number
  now?: () => number
}

export class SlidingWindowRateLimiter {
  private readonly now: () => number

  constructor(private readonly options: SlidingWindowRateLimiterOptions) {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new Error('Rate limit must be a positive integer')
    }
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
      throw new Error('Rate-limit window must be positive')
    }
    this.now = options.now ?? Date.now
  }

  async check(callerId: string): Promise<RateLimitResult> {
    const now = this.now()
    const result = await this.options.store.consume(
      callerId,
      now,
      this.options.windowMs,
      this.options.limit,
    )
    const allowed = result.count <= this.options.limit
    return {
      allowed,
      limit: this.options.limit,
      remaining: Math.max(0, this.options.limit - result.count),
      retryAfterMs: allowed ? 0 : Math.max(1, result.resetAt - now),
    }
  }
}
