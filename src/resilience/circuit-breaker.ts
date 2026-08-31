interface CircuitState {
  failures: number
  openedAt?: number
  halfOpenProbeInFlight: boolean
}

export class CircuitOpenError extends Error {
  readonly name = 'CircuitOpenError'

  constructor(
    readonly target: string,
    readonly retryAfterMs: number,
  ) {
    super(`Circuit breaker is open for ${target}; retry in ${retryAfterMs}ms`)
  }
}

export interface CircuitBreakerOptions {
  failureThreshold: number
  resetTimeoutMs: number
  now?: () => number
}

export class CircuitBreaker {
  private readonly states = new Map<string, CircuitState>()
  private readonly now: () => number

  constructor(private readonly options: CircuitBreakerOptions) {
    if (!Number.isInteger(options.failureThreshold) || options.failureThreshold < 1) {
      throw new Error('Circuit-breaker failure threshold must be a positive integer')
    }
    if (!Number.isFinite(options.resetTimeoutMs) || options.resetTimeoutMs <= 0) {
      throw new Error('Circuit-breaker reset timeout must be positive')
    }
    this.now = options.now ?? Date.now
  }

  async execute<T>(
    target: string,
    operation: () => Promise<T>,
    isFailure: (result: T) => boolean = () => false,
  ): Promise<T> {
    const state = this.states.get(target) ?? {
      failures: 0,
      halfOpenProbeInFlight: false,
    }
    this.states.set(target, state)

    if (state.openedAt !== undefined) {
      const retryAfterMs = state.openedAt + this.options.resetTimeoutMs - this.now()
      if (retryAfterMs > 0 || state.halfOpenProbeInFlight) {
        throw new CircuitOpenError(target, Math.max(1, retryAfterMs))
      }
      state.halfOpenProbeInFlight = true
    }

    try {
      const result = await operation()
      if (isFailure(result)) {
        this.recordFailure(state)
      } else {
        this.states.delete(target)
      }
      return result
    } catch (error) {
      this.recordFailure(state)
      throw error
    }
  }

  private recordFailure(state: CircuitState): void {
    state.halfOpenProbeInFlight = false
    state.failures++
    if (state.openedAt !== undefined || state.failures >= this.options.failureThreshold) {
      state.failures = this.options.failureThreshold
      state.openedAt = this.now()
    }
  }
}
