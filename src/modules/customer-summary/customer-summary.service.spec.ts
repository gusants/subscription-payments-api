import { Logger } from '@nestjs/common';
import { FakeLlmProvider } from '../../llm/fake-llm.provider.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { CachedSummaryResolver } from './cached-summary-resolver.js';
import type { CustomerPaymentRecord } from './customer-payment-record.js';
import { CustomerSummaryService } from './customer-summary.service.js';
import { lastEventId, summaryCacheKey } from './domain/index.js';
import { SummaryNarrator } from './summary-narrator.js';
import { InMemoryCustomerSummaryRepository } from './testing/in-memory-customer-summary.repository.js';
import { InMemorySummaryCacheStore } from './testing/in-memory-summary-cache.store.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

function paymentsOf(
  overrides: Partial<CustomerPaymentRecord> = {},
): CustomerPaymentRecord {
  return {
    customerId: 'cus_1',
    customerSince: new Date('2025-09-20T00:00:00.000Z'),
    plan: { interval: 'monthly', amountCents: 1990 },
    charges: [
      {
        subscriptionId: 'sub_1',
        periodStart: new Date('2026-05-10T00:00:00.000Z'),
        status: 'paid',
        method: 'card',
        amountCents: 1990,
        dueDate: new Date('2026-05-10T00:00:00.000Z'),
        paidAt: new Date('2026-05-12T00:00:00.000Z'),
        failureReason: null,
      },
    ],
    attempts: [{ result: 'declined' }, { result: 'succeeded' }],
    activity: {
      lastActivityAt: new Date('2026-05-12T00:00:00.000Z'),
      chargeCount: 1,
      attemptCount: 2,
    },
    ...overrides,
  };
}

describe('CustomerSummaryService', () => {
  let records: InMemoryCustomerSummaryRepository;
  let llm: FakeLlmProvider;
  let store: InMemorySummaryCacheStore;
  let service: CustomerSummaryService;
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    records = new InMemoryCustomerSummaryRepository();
    llm = new FakeLlmProvider({ model: 'fake-llm', timeoutMs: 20 });
    store = new InMemorySummaryCacheStore();
    const clock = new FixedClock(NOW);
    service = new CustomerSummaryService(
      records,
      new SummaryNarrator(llm, { version: 'v1', text: 'prompt' }, clock),
      new CachedSummaryResolver(store, {
        ttlSeconds: 3600,
        fallbackTtlSeconds: 30,
        lockSeconds: 20,
        waitMs: 100,
        pollMs: 5,
      }),
      clock,
    );
    records.put(paymentsOf());
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects an unknown customer', async () => {
    await expect(service.getSummary('cus_missing')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('narrates with the LLM and computes the metrics in code', async () => {
    const summary = await service.getSummary('cus_1');

    expect(summary).toMatchObject({
      customerId: 'cus_1',
      metrics: {
        monthsAsCustomer: 8,
        totalPaidCents: 1990,
        failedAttempts: 1,
        averageDaysLate: 2,
        paymentSuccessRate: 1,
      },
      record: {
        source: 'llm',
        promptVersion: 'v1',
        generatedAt: NOW,
        output: { paymentBehavior: 'on_time', riskLevel: 'low' },
      },
    });
  });

  it.each(['error', 'timeout', 'invalid_json'] as const)(
    'serves a fallback derived from the metrics when the provider is in %s mode',
    async (mode) => {
      llm.setMode(mode);

      const summary = await service.getSummary('cus_1');

      expect(summary.record.source).toBe('fallback');
      expect(summary.record.output).toMatchObject({
        paymentBehavior: 'occasional_delays',
        riskLevel: 'medium',
      });
      expect(summary.metrics.totalPaidCents).toBe(1990);
    },
  );

  it('does not call the provider again while nothing changed', async () => {
    const generate = vi.spyOn(llm, 'generateJson');

    await service.getSummary('cus_1');
    const second = await service.getSummary('cus_1');

    expect(generate).toHaveBeenCalledTimes(1);
    expect(second.record.source).toBe('llm');
  });

  it('calls the provider again after a new payment event', async () => {
    const generate = vi.spyOn(llm, 'generateJson');
    await service.getSummary('cus_1');

    const base = paymentsOf();
    records.put({
      ...base,
      activity: { ...base.activity, attemptCount: 3 },
    });
    await service.getSummary('cus_1');

    expect(generate).toHaveBeenCalledTimes(2);
    expect(store.records.size).toBe(2);
  });

  it('stores the summary under the key of the last event', async () => {
    await service.getSummary('cus_1');

    expect(
      store.records.has(
        summaryCacheKey('cus_1', lastEventId(paymentsOf().activity)),
      ),
    ).toBe(true);
  });

  it('answers even when the cache is down', async () => {
    store.failWith(new Error('Redis is down'));
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(service.getSummary('cus_1')).resolves.toMatchObject({
      record: { source: 'llm' },
    });
  });

  it('logs the call with model, prompt version, latency, tokens, source and cache', async () => {
    await service.getSummary('cus_1');
    await service.getSummary('cus_1');

    expect(log).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        event: 'customer_summary.served',
        customerId: 'cus_1',
        source: 'llm',
        promptVersion: 'v1',
        cache: 'miss',
        model: 'fake-llm',
        latencyMs: 0,
        inputTokens: null,
        outputTokens: null,
        failure: null,
      }),
    );
    expect(log).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cache: 'hit', model: null }),
    );
  });

  it('logs a fallback as a warning with the failure reason and no content', async () => {
    llm.setMode('invalid_json');

    const summary = await service.getSummary('cus_1');

    const [logged] = warn.mock.calls[0] as [Record<string, unknown>];
    expect(logged).toMatchObject({
      source: 'fallback',
      failure: 'invalid_output',
    });
    expect(JSON.stringify(logged)).not.toContain(summary.record.output.summary);
    expect(Object.keys(logged)).not.toEqual(
      expect.arrayContaining(['summary', 'context', 'text']),
    );
  });
});
