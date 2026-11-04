import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import type { SummaryRecord } from './customer-summary.js';
import { LruSummaryCache } from './lru-summary-cache.js';

const START = new Date('2026-06-01T00:00:00.000Z');

function recordOf(summary: string): SummaryRecord {
  return {
    source: 'llm',
    promptVersion: 'v2',
    generatedAt: START,
    output: {
      summary,
      paymentBehavior: 'on_time',
      riskLevel: 'low',
      suggestedAction: 'No action needed.',
    },
  };
}

describe('LruSummaryCache', () => {
  let clock: FixedClock;

  beforeEach(() => {
    clock = new FixedClock(START);
  });

  it('finds nothing for an unknown key', () => {
    expect(new LruSummaryCache(2, clock).find('a')).toBeNull();
  });

  it('returns what was saved until the TTL passes', () => {
    const cache = new LruSummaryCache(2, clock);
    cache.save('a', recordOf('A'), 10);

    clock.set(new Date(START.getTime() + 9_999));
    expect(cache.find('a')).toEqual(recordOf('A'));
    clock.set(new Date(START.getTime() + 10_000));
    expect(cache.find('a')).toBeNull();
  });

  it('evicts the least recently used entry beyond its capacity', () => {
    const cache = new LruSummaryCache(2, clock);
    cache.save('a', recordOf('A'), 60);
    cache.save('b', recordOf('B'), 60);
    cache.find('a');

    cache.save('c', recordOf('C'), 60);

    expect(cache.find('b')).toBeNull();
    expect(cache.find('a')).toEqual(recordOf('A'));
    expect(cache.find('c')).toEqual(recordOf('C'));
  });

  it('replaces an existing key and renews its TTL', () => {
    const cache = new LruSummaryCache(2, clock);
    cache.save('a', recordOf('old'), 10);
    clock.set(new Date(START.getTime() + 8_000));
    cache.save('a', recordOf('new'), 10);

    clock.set(new Date(START.getTime() + 15_000));

    expect(cache.find('a')).toEqual(recordOf('new'));
  });

  it('never holds more entries than its capacity', () => {
    const cache = new LruSummaryCache(3, clock);
    for (let index = 0; index < 20; index++) {
      cache.save(`k${index}`, recordOf(String(index)), 60);
    }

    const present = Array.from({ length: 20 }, (_, index) =>
      cache.find(`k${index}`),
    ).filter((record) => record !== null);
    expect(present).toHaveLength(3);
  });
});
