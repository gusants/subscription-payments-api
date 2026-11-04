import { FixedClock } from '../../../shared/clock/testing/fixed-clock.js';
import { LruSummaryCache } from '../lru-summary-cache.js';

const GENEROUS_CAPACITY = 500;

export function newSummaryMemory(clock = new FixedClock(new Date())) {
  return new LruSummaryCache(GENEROUS_CAPACITY, clock);
}
