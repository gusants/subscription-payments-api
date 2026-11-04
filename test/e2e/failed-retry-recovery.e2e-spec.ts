import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue, UnrecoverableError, Worker } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import {
  BILLING_QUEUE_PREFIX,
  CHARGE_RETRIES_QUEUE,
} from '../../src/modules/billing-queue/billing-queue.constants.js';
import { ChargeReconciliationRunner } from '../../src/modules/charges/charge-reconciliation-runner.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { findRetryJob, runRetryJob } from '../support/charge-retry-jobs.js';
import { createTestApp } from '../support/create-test-app.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = 6 * 60 * 1000;
const WORKER_TOKEN = 'e2e-worker-token';

describe('Failed retry job recovery (e2e)', () => {
  const startedAt = new Date('2026-01-31T10:30:00.000Z');
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FixedClock;

  beforeEach(async () => {
    clock = new FixedClock(startedAt);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = createTestApp(moduleRef);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
    await app
      .get<Queue>(getQueueToken(CHARGE_RETRIES_QUEUE))
      .obliterate({ force: true });
  });

  afterEach(async () => {
    await app.close();
  });

  async function subscribeDeclined() {
    const http = request(app.getHttpServer());
    const customer = await http
      .post('/customers')
      .send({ name: 'Ana', email: 'ana@example.com' })
      .expect(201);
    const plan = await http
      .post('/plans')
      .send({ name: 'Basic', amountCents: 1990, interval: 'monthly' })
      .expect(201);
    const response = await http
      .post('/subscriptions')
      .send({
        customerId: customer.body.id,
        planId: plan.body.id,
        paymentMethod: 'card',
        cardToken: 'tok_insufficient_funds',
      })
      .expect(201);
    return {
      subscriptionId: response.body.id as string,
      chargeId: response.body.latestCharge.id as string,
    };
  }

  async function exhaustTechnicalAttempts(chargeId: string): Promise<void> {
    const job = await findRetryJob(app, chargeId, 1);
    await job!.promote();
    const worker = new Worker(CHARGE_RETRIES_QUEUE, null, {
      prefix: BILLING_QUEUE_PREFIX,
      connection: { host: inject('redisHost'), port: inject('redisPort') },
    });
    try {
      const active = await worker.getNextJob(WORKER_TOKEN);
      await active!.moveToFailed(
        new UnrecoverableError('gateway unavailable on every attempt'),
        WORKER_TOKEN,
        false,
      );
    } finally {
      await worker.close();
    }
    expect(await (await findRetryJob(app, chargeId, 1))?.getState()).toBe(
      'failed',
    );
  }

  async function recoverCharge(subscriptionId: string, chargeId: string) {
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { cardToken: 'tok_success' },
    });
    await runRetryJob(app, chargeId, 1);
    expect(
      await prisma.charge.findUniqueOrThrow({ where: { id: chargeId } }),
    ).toMatchObject({ status: 'paid', retryCount: 1 });
    expect(
      await prisma.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      }),
    ).toMatchObject({ status: 'active' });
  }

  it('manual retry of a charge whose retry job failed — requeues that job instead of answering queued with nothing to run', async () => {
    const { subscriptionId, chargeId } = await subscribeDeclined();
    await exhaustTechnicalAttempts(chargeId);

    await request(app.getHttpServer())
      .post(`/charges/${chargeId}/retry`)
      .expect(202);

    expect(await (await findRetryJob(app, chargeId, 1))?.getState()).toBe(
      'waiting',
    );
    await recoverCharge(subscriptionId, chargeId);
  });

  it('reconciliation sweep — finds the retry job failed past its slot — requeues it', async () => {
    const { subscriptionId, chargeId } = await subscribeDeclined();
    await exhaustTechnicalAttempts(chargeId);
    clock.set(new Date(startedAt.getTime() + DAY_MS + GRACE_MS));

    const summary = await app.get(ChargeReconciliationRunner).run();

    expect(summary.dunningFollowUps).toBe(1);
    expect(await (await findRetryJob(app, chargeId, 1))?.getState()).toBe(
      'waiting',
    );
    await recoverCharge(subscriptionId, chargeId);
  });
});
