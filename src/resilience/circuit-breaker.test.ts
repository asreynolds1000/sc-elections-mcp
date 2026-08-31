import { describe, expect, it, vi } from 'vitest'
import { CircuitBreaker } from './circuit-breaker.js'

describe('CircuitBreaker', () => {
  it('opens after repeated upstream failures', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 30_000,
      now: () => 1_000,
    })
    const upstreamCall = vi.fn(async () => {
      throw new Error('upstream unavailable')
    })

    await expect(breaker.execute('ethicsfiling.sc.gov', upstreamCall)).rejects.toThrow('upstream unavailable')
    await expect(breaker.execute('ethicsfiling.sc.gov', upstreamCall)).rejects.toThrow('upstream unavailable')
    await expect(breaker.execute('ethicsfiling.sc.gov', upstreamCall)).rejects.toMatchObject({
      name: 'CircuitOpenError',
    })
    expect(upstreamCall).toHaveBeenCalledTimes(2)
  })
})
