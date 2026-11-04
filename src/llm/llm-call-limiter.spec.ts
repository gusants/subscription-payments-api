import { FixedClock } from '../shared/clock/testing/fixed-clock.js';
import { LlmCallLimiter } from './llm-call-limiter.js';

const START = new Date('2026-06-01T00:00:00.000Z');
const after = (ms: number) => new Date(START.getTime() + ms);

describe('LlmCallLimiter', () => {
  let clock: FixedClock;

  beforeEach(() => {
    clock = new FixedClock(START);
  });

  it('allows a burst up to the per-minute budget and then refuses', () => {
    const limiter = new LlmCallLimiter(3, clock);

    const outcomes = [1, 2, 3, 4].map(() => limiter.tryAcquire());

    expect(outcomes).toEqual([true, true, true, false]);
  });

  it('refills proportionally to the elapsed time', () => {
    const limiter = new LlmCallLimiter(6, clock);
    for (let call = 0; call < 6; call++) limiter.tryAcquire();

    clock.set(after(9_999));
    expect(limiter.tryAcquire()).toBe(false);
    clock.set(after(10_000));
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('never accumulates more than one minute of budget', () => {
    const limiter = new LlmCallLimiter(2, clock);
    clock.set(after(10 * 60_000));

    const outcomes = [1, 2, 3].map(() => limiter.tryAcquire());

    expect(outcomes).toEqual([true, true, false]);
  });

  it('ignores a clock that goes backwards', () => {
    const limiter = new LlmCallLimiter(1, clock);
    limiter.tryAcquire();
    clock.set(after(-60_000));

    expect(limiter.tryAcquire()).toBe(false);
  });
});
