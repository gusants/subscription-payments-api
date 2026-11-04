import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { BILLING_QUEUE_NAMES } from '../../src/modules/billing-queue/billing-queue.constants.js';
import { BillingQueue } from '../../src/modules/billing-queue/billing-queue.port.js';
import { BillingQueueModule } from '../../src/modules/billing-queue/billing-queue.module.js';
import { BillingWorkersModule } from '../../src/modules/billing-queue/processors/billing-workers.module.js';
import { AppConfigModule } from '../../src/shared/config/app-config.module.js';
import { createTestApp } from '../support/create-test-app.js';

async function createQueueApp(env: Record<string, unknown> = {}) {
  const moduleRef = await Test.createTestingModule({
    imports: [AppConfigModule, BillingQueueModule.register(env)],
  }).compile();
  const app = createTestApp<App>(moduleRef);
  await app.init();
  return app;
}

describe('Billing queues (e2e)', () => {
  const apps: INestApplication<App>[] = [];

  const start = async (env?: Record<string, unknown>) => {
    const app = await createQueueApp(env);
    apps.push(app);
    return app;
  };

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it.each(BILLING_QUEUE_NAMES)('registers the %s queue', async (name) => {
    const app = await start();

    const queue = app.get<Queue>(getQueueToken(name));

    expect(queue.name).toBe(name);
    expect(await queue.getJobCounts()).toMatchObject({ waiting: 0 });
  });

  it('keys the queues under the bull prefix with bounded completed jobs and kept failures', async () => {
    const app = await start();

    const queue = app.get<Queue>(getQueueToken(BILLING_QUEUE_NAMES[0]));

    expect(queue.opts.prefix).toBe('bull');
    expect(queue.jobsOpts).toMatchObject({
      removeOnComplete: { count: 1000, age: 86400 },
      removeOnFail: false,
    });
  });

  it('exposes the BillingQueue port that enqueues into charge-retries', async () => {
    const app = await start({ WORKERS_ENABLED: 'false' });
    const chargeId = `ch_e2e_${Date.now()}`;

    await app
      .get(BillingQueue)
      .scheduleRetry({ chargeId, attempt: 1, delayMs: 3_600_000 });

    const queue = app.get<Queue>(getQueueToken('charge-retries'));
    const job = await queue.getJob(`retry:${chargeId}:1`);
    expect(await job?.getState()).toBe('delayed');
    await job?.remove();
  });

  describe('Bull Board', () => {
    it('serves the three queues at /queues outside production', async () => {
      const app = await start({ NODE_ENV: 'development' });

      const page = await request(app.getHttpServer())
        .get('/queues')
        .expect(200);
      const queues = await request(app.getHttpServer())
        .get('/queues/api/queues')
        .expect(200);

      expect(page.text).toContain('<html');
      expect(
        queues.body.queues.map((queue: { name: string }) => queue.name).sort(),
      ).toEqual([...BILLING_QUEUE_NAMES].sort());
    });

    it('answers 404 in production', async () => {
      const app = await start({ NODE_ENV: 'production' });

      await request(app.getHttpServer()).get('/queues').expect(404);
    });

    it('serves in production when the flag is explicitly true', async () => {
      const app = await start({
        NODE_ENV: 'production',
        BULL_BOARD_ENABLED: 'true',
      });

      await request(app.getHttpServer()).get('/queues').expect(200);
    });

    it('answers 404 outside production when the flag is explicitly false', async () => {
      const app = await start({
        NODE_ENV: 'development',
        BULL_BOARD_ENABLED: 'false',
      });

      await request(app.getHttpServer()).get('/queues').expect(404);
    });
  });

  describe('workers', () => {
    it('registers the workers module by default', async () => {
      const app = await start();

      expect(app.get(BillingWorkersModule, { strict: false })).toBeDefined();
    });

    it('registers no workers when WORKERS_ENABLED is false', async () => {
      const app = await start({ WORKERS_ENABLED: 'false' });

      expect(() => app.get(BillingWorkersModule, { strict: false })).toThrow();
      expect(
        app.get<Queue>(getQueueToken(BILLING_QUEUE_NAMES[0])),
      ).toBeDefined();
    });
  });
});
