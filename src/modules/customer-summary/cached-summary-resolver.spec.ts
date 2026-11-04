import { Logger } from '@nestjs/common';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import type { Narration, SummaryRecord } from './customer-summary.js';
import { summaryCacheKey } from './domain/index.js';
import {
  CachedSummaryResolver,
  type GenerateSummary,
} from './cached-summary-resolver.js';
import type { SummaryCacheOptions } from './summary-cache.options.js';
import { newSummaryMemory } from './testing/unbounded-summary-memory.js';
import { InMemorySummaryCacheStore } from './testing/in-memory-summary-cache.store.js';

const options: SummaryCacheOptions = {
  ttlSeconds: 3600,
  fallbackTtlSeconds: 30,
  lockSeconds: 20,
  waitMs: 200,
  pollMs: 5,
};

function recordOf(source: SummaryRecord['source']): SummaryRecord {
  return {
    source,
    promptVersion: 'v1',
    generatedAt: new Date('2026-06-01T00:00:00.000Z'),
    output: {
      summary: 'Pays on time.',
      paymentBehavior: 'on_time',
      riskLevel: 'low',
      suggestedAction: 'No action needed.',
    },
  };
}

function narrationOf(source: SummaryRecord['source']): Narration {
  return {
    record: recordOf(source),
    usage: { model: 'm', inputTokens: 1, outputTokens: 2, latencyMs: 3 },
    failure: source === 'fallback' ? 'timeout' : null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('CachedSummaryResolver', () => {
  let store: InMemorySummaryCacheStore;
  let resolver: CachedSummaryResolver;
  const key = summaryCacheKey('cus_1', 'evt_1');

  beforeEach(() => {
    store = new InMemorySummaryCacheStore();
    resolver = new CachedSummaryResolver(store, options, newSummaryMemory());
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates and stores on a miss', async () => {
    const generate = vi.fn<GenerateSummary>(async () => narrationOf('llm'));

    const result = await resolver.resolve('cus_1', 'evt_1', generate);

    expect(result).toEqual({ narration: narrationOf('llm'), cache: 'miss' });
    expect(store.records.get(key)).toEqual({
      record: recordOf('llm'),
      ttlSeconds: 3600,
    });
    expect(store.holdsLock(key)).toBe(false);
  });

  it('serves a stored summary without generating', async () => {
    await store.save(key, recordOf('llm'), 60);
    const generate = vi.fn<GenerateSummary>();

    const result = await resolver.resolve('cus_1', 'evt_1', generate);

    expect(generate).not.toHaveBeenCalled();
    expect(result).toEqual({
      narration: { record: recordOf('llm'), usage: null, failure: null },
      cache: 'hit',
    });
  });

  it('generates again for a different last event', async () => {
    const generate = vi.fn<GenerateSummary>(async () => narrationOf('llm'));

    await resolver.resolve('cus_1', 'evt_1', generate);
    await resolver.resolve('cus_1', 'evt_2', generate);

    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('keeps a fallback only for the short TTL', async () => {
    await resolver.resolve('cus_1', 'evt_1', async () =>
      narrationOf('fallback'),
    );

    expect(store.records.get(key)?.ttlSeconds).toBe(30);
  });

  it('makes one generation for simultaneous requests in the same process', async () => {
    const answer = deferred<Narration>();
    const generate = vi.fn<GenerateSummary>(() => answer.promise);

    const requests = Array.from({ length: 10 }, () =>
      resolver.resolve('cus_1', 'evt_1', generate),
    );
    answer.resolve(narrationOf('llm'));
    const results = await Promise.all(requests);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(results.map(({ cache }) => cache).sort()).toEqual([
      'coalesced',
      'coalesced',
      'coalesced',
      'coalesced',
      'coalesced',
      'coalesced',
      'coalesced',
      'coalesced',
      'coalesced',
      'miss',
    ]);
  });

  it('makes one generation across processes sharing the store', async () => {
    const other = new CachedSummaryResolver(store, options, newSummaryMemory());
    const answer = deferred<Narration>();
    const generate = vi.fn<GenerateSummary>(() => answer.promise);

    const first = resolver.resolve('cus_1', 'evt_1', generate);
    await vi.waitFor(() => expect(store.holdsLock(key)).toBe(true));
    const second = other.resolve('cus_1', 'evt_1', generate);
    answer.resolve(narrationOf('llm'));

    expect(await first).toMatchObject({ cache: 'miss' });
    expect(await second).toMatchObject({ cache: 'coalesced' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('shares a fallback with the waiters instead of retrying the provider', async () => {
    const other = new CachedSummaryResolver(store, options, newSummaryMemory());
    const answer = deferred<Narration>();
    const generate = vi.fn<GenerateSummary>(() => answer.promise);

    const first = resolver.resolve('cus_1', 'evt_1', generate);
    await vi.waitFor(() => expect(store.holdsLock(key)).toBe(true));
    const second = other.resolve('cus_1', 'evt_1', generate);
    answer.resolve(narrationOf('fallback'));
    await Promise.all([first, second]);

    expect(generate).toHaveBeenCalledTimes(1);
    expect((await second).narration.record.source).toBe('fallback');
  });

  it('generates without the lock when its holder never finishes', async () => {
    await store.acquireLock(key);
    const generate = vi.fn<GenerateSummary>(async () => narrationOf('llm'));

    const result = await resolver.resolve('cus_1', 'evt_1', generate);

    expect(result.cache).toBe('bypass');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(store.records.has(key)).toBe(false);
  });

  it('generates without cache when the store is down, and never throws', async () => {
    store.failWith(new Error('Redis is down'));
    const generate = vi.fn<GenerateSummary>(async () => narrationOf('llm'));

    const result = await resolver.resolve('cus_1', 'evt_1', generate);

    expect(result).toEqual({ narration: narrationOf('llm'), cache: 'bypass' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('serves repeated requests from memory while the store is down', async () => {
    store.failWith(new Error('Redis is down'));
    const generate = vi.fn<GenerateSummary>(async () => narrationOf('llm'));

    await resolver.resolve('cus_1', 'evt_1', generate);
    const second = await resolver.resolve('cus_1', 'evt_1', generate);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(second).toEqual({
      narration: { record: recordOf('llm'), usage: null, failure: null },
      cache: 'memory',
    });
  });

  it('keeps a fallback in memory only for the short TTL', async () => {
    const clock = new FixedClock(new Date('2026-06-01T00:00:00.000Z'));
    const shortLived = new CachedSummaryResolver(
      store,
      options,
      newSummaryMemory(clock),
    );
    store.failWith(new Error('Redis is down'));
    const generate = vi.fn<GenerateSummary>(async () =>
      narrationOf('fallback'),
    );

    await shortLived.resolve('cus_1', 'evt_1', generate);
    clock.set(new Date('2026-06-01T00:00:31.000Z'));
    await shortLived.resolve('cus_1', 'evt_1', generate);

    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('does not use memory while the store is healthy', async () => {
    const generate = vi.fn<GenerateSummary>(async () => narrationOf('llm'));
    await resolver.resolve('cus_1', 'evt_1', generate);
    store.records.clear();

    const result = await resolver.resolve('cus_1', 'evt_1', generate);

    expect(result.cache).toBe('miss');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('still coalesces in-process requests while the store is down', async () => {
    store.failWith(new Error('Redis is down'));
    const answer = deferred<Narration>();
    const generate = vi.fn<GenerateSummary>(() => answer.promise);

    const requests = [1, 2, 3].map(() =>
      resolver.resolve('cus_1', 'evt_1', generate),
    );
    answer.resolve(narrationOf('llm'));
    await Promise.all(requests);

    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('returns the generated summary when saving it fails', async () => {
    vi.spyOn(store, 'save').mockRejectedValue(new Error('write failed'));

    const result = await resolver.resolve('cus_1', 'evt_1', async () =>
      narrationOf('llm'),
    );

    expect(result.cache).toBe('miss');
    expect(store.holdsLock(key)).toBe(false);
  });

  it('releases the lock and propagates a generation failure once', async () => {
    const generate = vi.fn<GenerateSummary>(() =>
      Promise.reject(new Error('boom')),
    );

    await expect(resolver.resolve('cus_1', 'evt_1', generate)).rejects.toThrow(
      'boom',
    );

    expect(generate).toHaveBeenCalledTimes(1);
    expect(store.holdsLock(key)).toBe(false);
  });

  it('survives a failing lock release', async () => {
    vi.spyOn(store, 'releaseLock').mockRejectedValue(new Error('gone'));

    const result = await resolver.resolve('cus_1', 'evt_1', async () =>
      narrationOf('llm'),
    );

    expect(result.cache).toBe('miss');
  });
});
