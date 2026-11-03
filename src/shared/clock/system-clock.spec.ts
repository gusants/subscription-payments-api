import { SystemClock } from './system-clock.js';

describe('SystemClock', () => {
  it('returns the current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T12:00:00.000Z'));

    expect(new SystemClock().now()).toEqual(
      new Date('2026-11-03T12:00:00.000Z'),
    );

    vi.useRealTimers();
  });
});
