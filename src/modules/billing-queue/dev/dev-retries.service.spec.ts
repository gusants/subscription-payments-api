import { Logger } from '@nestjs/common';
import { ServiceUnavailableError } from '../../../shared/errors/index.js';
import { RecordingBillingQueue } from '../testing/recording-billing-queue.js';
import { DevRetriesController } from './dev-retries.controller.js';
import { DevRetriesService } from './dev-retries.service.js';

describe('DevRetriesController', () => {
  let queue: RecordingBillingQueue;
  let controller: DevRetriesController;

  beforeEach(() => {
    queue = new RecordingBillingQueue();
    controller = new DevRetriesController(new DevRetriesService(queue));
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports how many delayed retries were promoted', async () => {
    await queue.scheduleRetry({
      chargeId: 'ch_1',
      attempt: 1,
      correlationId: 'cor_test_journey',
      delayMs: 1000,
    });
    await queue.scheduleRetry({
      chargeId: 'ch_2',
      attempt: 1,
      correlationId: 'cor_test_journey',
      delayMs: 5000,
    });

    expect(await controller.runNow()).toEqual({ promoted: 2 });
    expect(queue.scheduled().every(({ delayMs }) => delayMs === 0)).toBe(true);
  });

  it('reports zero when nothing is delayed', async () => {
    await queue.scheduleRetry({
      chargeId: 'ch_1',
      attempt: 1,
      correlationId: 'cor_test_journey',
      delayMs: 0,
    });

    expect(await controller.runNow()).toEqual({ promoted: 0 });
  });

  it('answers service unavailable when the queue cannot be reached', async () => {
    vi.spyOn(queue, 'promoteDelayedRetries').mockRejectedValue(
      new Error('redis down'),
    );

    await expect(controller.runNow()).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
  });
});
