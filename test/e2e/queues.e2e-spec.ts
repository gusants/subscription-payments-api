import { rm } from 'node:fs/promises';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { BillingQueue } from '../../src/modules/billing-queue/billing-queue.port.js';
import { SubscriptionRenewalRunner } from '../../src/modules/charges/subscription-renewal-runner.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { findRetryJob, runRetryJob } from '../support/charge-retry-jobs.js';
import { createTestApp } from '../support/create-test-app.js';
import {
  chargeEvent,
  signedHeaders,
  WEBHOOK_PATH,
} from '../support/gateway-webhook-fixtures.js';

vi.hoisted(() => {
  process.env['WORKERS_ENABLED'] = 'true';
});

const WORKER_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 100;
const TECHNICAL_BACKOFF_TEST_TIMEOUT_MS = 30_000;
const secondsOf = (date: Date) => Math.floor(date.getTime() / 1000);

describe('Billing queues end to end (e2e)', () => {
  let app: INestApplication<App>;
  let clock: FixedClock;
  let prisma: PrismaService;

  beforeAll(async () => {
    const { AppModule } = await import('../../src/app.module.js');
    clock = new FixedClock(new Date('2026-01-31T10:30:00.000Z'));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = createTestApp(moduleRef);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    clock.set(new Date('2026-01-31T10:30:00.000Z'));
    await rm(process.env['FAKE_GATEWAY_DATA_FILE']!, { force: true });
    await prisma.webhookEvent.deleteMany();
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
    await chargeRetries().obliterate({ force: true });
  });

  afterAll(async () => {
    await queueOf('subscription-renewals').removeJobScheduler(
      'subscription-renewals',
    );
    await queueOf('charge-reconciliation').removeJobScheduler(
      'charge-reconciliation',
    );
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const queueOf = (name: string) => app.get<Queue>(getQueueToken(name));
  const chargeRetries = () => queueOf('charge-retries');

  async function subscribe(
    paymentMethod: 'card' | 'pix' | 'boleto',
    cardToken?: string,
  ) {
    const customer = await http()
      .post('/customers')
      .send({ name: 'Ana', email: 'ana@example.com' })
      .expect(201);
    const plan = await http()
      .post('/plans')
      .send({ name: 'Basic', amountCents: 1990, interval: 'monthly' })
      .expect(201);
    const response = await http()
      .post('/subscriptions')
      .send({
        customerId: customer.body.id,
        planId: plan.body.id,
        paymentMethod,
        ...(cardToken && { cardToken }),
      })
      .expect(201);
    return {
      subscriptionId: response.body.id as string,
      chargeId: response.body.latestCharge.id as string,
    };
  }

  const charge = (id: string) =>
    prisma.charge.findUniqueOrThrow({ where: { id } });

  const subscriptionStatus = async (id: string) =>
    (await http().get(`/subscriptions/${id}`).expect(200)).body.status;

  const retryJobsOf = async (chargeId: string) =>
    (await chargeRetries().getJobs()).filter(({ id }) =>
      id?.startsWith(`retry:${chargeId}:`),
    );

  async function runNowAndWaitForAttempt(chargeId: string, attempt: number) {
    await vi.waitFor(
      async () =>
        expect(
          await (await findRetryJob(app, chargeId, attempt))?.getState(),
        ).toBe('delayed'),
      { timeout: WORKER_TIMEOUT_MS, interval: POLL_INTERVAL_MS },
    );
    await http().post('/dev/retries/run-now').expect(200);
    await vi.waitFor(
      async () =>
        expect(
          await (await findRetryJob(app, chargeId, attempt))?.isCompleted(),
        ).toBe(true),
      { timeout: WORKER_TIMEOUT_MS, interval: POLL_INTERVAL_MS },
    );
  }

  it('the same retry scheduled by the processor and again by the queue port — leaves one job', async () => {
    const { chargeId } = await subscribe('card', 'tok_insufficient_funds');
    const queue = app.get(BillingQueue);

    await Promise.all([
      queue.scheduleRetry({
        chargeId,
        attempt: 1,
        correlationId: 'cor_test_journey',
        delayMs: 86_400_000,
      }),
      queue.scheduleRetry({
        chargeId,
        attempt: 1,
        correlationId: 'cor_test_journey',
        delayMs: 0,
      }),
    ]);

    const jobs = await retryJobsOf(chargeId);
    expect(jobs.map(({ id }) => id)).toEqual([`retry:${chargeId}:1`]);
  });

  it('a charge.failed webhook delivered after the processor scheduled the retry — keeps a single job', async () => {
    const { chargeId } = await subscribe('card', 'tok_insufficient_funds');
    const { gatewayChargeId } = await charge(chargeId);
    const rawBody = JSON.stringify(
      chargeEvent('charge.failed', {
        id: gatewayChargeId!,
        externalRef: chargeId,
        method: 'card',
        failureReason: 'insufficient_funds',
      }),
    );

    await http()
      .post(WEBHOOK_PATH)
      .set(
        signedHeaders(
          rawBody,
          process.env['GATEWAY_WEBHOOK_SECRET']!,
          secondsOf(clock.now()),
        ),
      )
      .send(rawBody)
      .expect(200);

    const jobs = await retryJobsOf(chargeId);
    expect(jobs.map(({ id }) => id)).toEqual([`retry:${chargeId}:1`]);
  });

  it(
    'technical failure on a retry — backed off by BullMQ — settles without counting a client attempt',
    async () => {
      const { subscriptionId, chargeId } = await subscribe(
        'card',
        'tok_insufficient_funds',
      );
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { cardToken: 'tok_timeout_then_success' },
      });

      await runNowAndWaitForAttempt(chargeId, 1);

      expect(await charge(chargeId)).toMatchObject({
        status: 'paid',
        retryCount: 1,
      });
      expect(await prisma.paymentAttempt.count({ where: { chargeId } })).toBe(
        2,
      );
      expect(await subscriptionStatus(subscriptionId)).toBe('active');
      expect((await findRetryJob(app, chargeId, 1))?.attemptsMade).toBe(2);
    },
    TECHNICAL_BACKOFF_TEST_TIMEOUT_MS,
  );

  it('tok_fail_then_success — past_due retried by the worker — becomes active', async () => {
    const { subscriptionId, chargeId } = await subscribe(
      'card',
      'tok_fail_then_success',
    );
    expect(await subscriptionStatus(subscriptionId)).toBe('past_due');

    await runNowAndWaitForAttempt(chargeId, 1);

    expect(await charge(chargeId)).toMatchObject({ status: 'paid' });
    expect(await subscriptionStatus(subscriptionId)).toBe('active');
  });

  it('every retry declined — third failure — makes the charge uncollectible and cancels the subscription', async () => {
    const { subscriptionId, chargeId } = await subscribe(
      'card',
      'tok_insufficient_funds',
    );

    await runNowAndWaitForAttempt(chargeId, 1);
    await runNowAndWaitForAttempt(chargeId, 2);
    await runNowAndWaitForAttempt(chargeId, 3);

    expect(await charge(chargeId)).toMatchObject({
      status: 'uncollectible',
      retryCount: 3,
    });
    expect(await subscriptionStatus(subscriptionId)).toBe('canceled');
    expect(await findRetryJob(app, chargeId, 4)).toBeUndefined();
  });

  it('run-now — with a delayed retry — promotes it and the worker processes it', async () => {
    const { subscriptionId, chargeId } = await subscribe(
      'card',
      'tok_fail_then_success',
    );
    expect(await (await findRetryJob(app, chargeId, 1))?.getState()).toBe(
      'delayed',
    );

    const response = await http().post('/dev/retries/run-now').expect(200);

    expect(response.body).toEqual({ promoted: 1 });
    await vi.waitFor(
      async () =>
        expect(await subscriptionStatus(subscriptionId)).toBe('active'),
      { timeout: WORKER_TIMEOUT_MS, interval: POLL_INTERVAL_MS },
    );
  });

  it('renewal run concurrently twice — bills the next period once', async () => {
    const { subscriptionId } = await subscribe('card', 'tok_success');
    clock.set(new Date('2026-03-01T00:00:00.000Z'));
    const runner = app.get(SubscriptionRenewalRunner);

    await Promise.all([runner.run(), runner.run()]);
    await runner.run();

    const charges = await prisma.charge.findMany({
      where: { subscriptionId },
      orderBy: { periodStart: 'asc' },
    });
    expect(charges.map(({ status }) => status)).toEqual(['paid', 'paid']);
  });

  it.each(['pix', 'boleto'] as const)(
    '%s retry after the charge expired — reissued twice — leaves a single new pending charge',
    async (method) => {
      const { subscriptionId, chargeId } = await subscribe(
        'card',
        'tok_success',
      );
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: { paymentMethod: method, cardToken: null },
      });
      await prisma.charge.update({
        where: { id: chargeId },
        data: {
          status: 'expired',
          method,
          paidAt: null,
          firstFailedAt: clock.now(),
        },
      });

      await runRetryJob(app, chargeId, 1);
      await runRetryJob(app, chargeId, 1);

      const charges = await prisma.charge.findMany({
        where: { subscriptionId },
        orderBy: { createdAt: 'asc' },
      });
      expect(
        charges.map(({ status, retryCount }) => ({ status, retryCount })),
      ).toEqual([
        { status: 'expired', retryCount: 0 },
        { status: 'pending', retryCount: 1 },
      ]);
    },
  );
});
