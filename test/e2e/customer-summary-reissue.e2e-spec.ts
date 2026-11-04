import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { runRetryJob } from '../support/charge-retry-jobs.js';
import { createTestApp } from '../support/create-test-app.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Customer summary after a pix reissue (e2e)', () => {
  const startedAt = new Date('2026-01-31T10:30:00.000Z');
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FixedClock;

  beforeAll(async () => {
    clock = new FixedClock(startedAt);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = createTestApp(moduleRef);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  async function subscribeWithPix() {
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
    await prisma.subscription.update({
      where: { id: subscription.body.id },
      data: { paymentMethod: 'pix', cardToken: null },
    });
    return {
      customerId: customer.body.id as string,
      subscriptionId: subscription.body.id as string,
      chargeId: subscription.body.latestCharge.id as string,
    };
  }

  it('counts a pix period paid on the reissued QR as one paid period, not as a 50% rate', async () => {
    const { customerId, subscriptionId, chargeId } = await subscribeWithPix();
    await prisma.charge.update({
      where: { id: chargeId },
      data: {
        status: 'expired',
        method: 'pix',
        paidAt: null,
        firstFailedAt: startedAt,
      },
    });
    clock.set(new Date(startedAt.getTime() + DAY_MS));
    await runRetryJob(app, chargeId, 1);
    const reissued = await prisma.charge.findFirstOrThrow({
      where: { subscriptionId, retryCount: 1 },
    });
    await prisma.charge.update({
      where: { id: reissued.id },
      data: { status: 'paid', paidAt: clock.now() },
    });

    const response = await request(app.getHttpServer())
      .get(`/customers/${customerId}/summary`)
      .expect(200);

    expect(await prisma.charge.count({ where: { subscriptionId } })).toBe(2);
    expect(response.body.metrics).toMatchObject({
      paymentSuccessRate: 1,
      failedAttempts: 1,
      totalPaidCents: 1990,
    });
  });
});
