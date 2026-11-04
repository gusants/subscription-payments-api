import { Logger } from '@nestjs/common';
import { FakeLlmProvider } from '../../llm/fake-llm.provider.js';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { CachedSummaryResolver } from './cached-summary-resolver.js';
import { CustomerSummaryController } from './customer-summary.controller.js';
import { CustomerSummaryService } from './customer-summary.service.js';
import { SummaryNarrator } from './summary-narrator.js';
import { InMemoryCustomerSummaryRepository } from './testing/in-memory-customer-summary.repository.js';
import { InMemorySummaryCacheStore } from './testing/in-memory-summary-cache.store.js';

describe('CustomerSummaryController', () => {
  let records: InMemoryCustomerSummaryRepository;
  let controller: CustomerSummaryController;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    records = new InMemoryCustomerSummaryRepository();
    const clock = new FixedClock(new Date('2026-06-01T00:00:00.000Z'));
    controller = new CustomerSummaryController(
      new CustomerSummaryService(
        records,
        new SummaryNarrator(
          new FakeLlmProvider({ model: 'fake-llm', timeoutMs: 20 }),
          { version: 'v1', text: 'prompt' },
          clock,
        ),
        new CachedSummaryResolver(new InMemorySummaryCacheStore(), {
          ttlSeconds: 60,
          fallbackTtlSeconds: 30,
          lockSeconds: 20,
          waitMs: 50,
          pollMs: 5,
        }),
        clock,
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes the summary of a customer', async () => {
    records.put({
      customerId: 'cus_1',
      customerSince: new Date('2026-01-01T00:00:00.000Z'),
      plan: null,
      charges: [],
      attempts: [],
      activity: { lastActivityAt: null, chargeCount: 0, attemptCount: 0 },
    });

    const response = await controller.summary('cus_1');

    expect(response).toMatchObject({
      customerId: 'cus_1',
      source: 'llm',
      promptVersion: 'v1',
      generatedAt: '2026-06-01T00:00:00.000Z',
      metrics: { monthsAsCustomer: 5, paymentSuccessRate: null },
    });
  });

  it('propagates NotFoundError for an unknown customer', async () => {
    await expect(controller.summary('cus_missing')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
