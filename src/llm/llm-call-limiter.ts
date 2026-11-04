import type { Clock } from '../shared/clock/clock.js';

const MILLISECONDS_PER_MINUTE = 60_000;

export class LlmCallLimiter {
  private available: number;
  private refilledAt: number;

  constructor(
    private readonly callsPerMinute: number,
    private readonly clock: Clock,
  ) {
    this.available = callsPerMinute;
    this.refilledAt = clock.now().getTime();
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.available < 1) return false;
    this.available -= 1;
    return true;
  }

  private refill(): void {
    const now = this.clock.now().getTime();
    const elapsedMs = Math.max(0, now - this.refilledAt);
    this.available = Math.min(
      this.callsPerMinute,
      this.available +
        (elapsedMs * this.callsPerMinute) / MILLISECONDS_PER_MINUTE,
    );
    this.refilledAt = now;
  }
}
