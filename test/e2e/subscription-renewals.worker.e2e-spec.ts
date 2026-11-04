import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { createTestApp } from '../support/create-test-app.js';

vi.hoisted(() => {
  process.env['WORKERS_ENABLED'] = 'true';
  process.env['RENEWAL_JOB_INTERVAL_SECONDS'] = '1';
});

describe('Subscription renewals worker (e2e)', () => {
  let app: INestApplication<App>;

  afterEach(async () => {
    await app.close();
  });

  it('registers the repeatable scheduler and renews due subscriptions on its own', async () => {
    const { AppModule } = await import('../../src/app.module.js');
    const clock = new FixedClock(new Date('2026-01-31T10:30:00.000Z'));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = createTestApp(moduleRef);
    await app.init();
    const prisma = app.get(PrismaService);
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
    const http = request(app.getHttpServer());
    const customer = await http
      .post('/customers')
      .send({ name: 'Ana', email: 'ana@example.com' })
      .expect(201);
    const plan = await http
      .post('/plans')
      .send({ name: 'Basic', amountCents: 1990, interval: 'monthly' })
      .expect(201);
    const subscription = await http
      .post('/subscriptions')
      .send({
        customerId: customer.body.id,
        planId: plan.body.id,
        paymentMethod: 'card',
        cardToken: 'tok_success',
      })
      .expect(201);

    clock.set(new Date('2026-03-01T00:00:00.000Z'));

    await vi.waitFor(
      async () =>
        expect(
          await prisma.charge.count({
            where: { subscriptionId: subscription.body.id as string },
          }),
        ).toBe(2),
      { timeout: 15_000, interval: 250 },
    );
    const queue = app.get<Queue>(getQueueToken('subscription-renewals'));
    expect(await queue.getJobScheduler('subscription-renewals')).toMatchObject({
      every: 1000,
    });
    await queue.removeJobScheduler('subscription-renewals');
  });
});
