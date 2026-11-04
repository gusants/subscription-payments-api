import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { SubscriptionRenewalRunner } from '../../src/modules/charges/subscription-renewal-runner.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { createTestApp } from '../support/create-test-app.js';

describe('Subscription renewals (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FixedClock;

  beforeEach(async () => {
    clock = new FixedClock(new Date('2026-01-31T10:30:00.000Z'));
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
  });

  afterEach(async () => {
    await app.close();
  });

  async function subscribe(cardToken: string) {
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
        cardToken,
      })
      .expect(201);
    return response.body.id as string;
  }

  it('bills the next period once and moves the subscription to it', async () => {
    const subscriptionId = await subscribe('tok_success');
    clock.set(new Date('2026-03-01T00:00:00.000Z'));
    const runner = app.get(SubscriptionRenewalRunner);

    await runner.run();
    const second = await runner.run();

    const charges = await prisma.charge.findMany({
      where: { subscriptionId },
      orderBy: { periodStart: 'asc' },
    });
    expect(charges.map(({ status }) => status)).toEqual(['paid', 'paid']);
    expect(charges[1]?.periodStart).toEqual(
      new Date('2026-02-28T10:30:00.000Z'),
    );
    expect(second.found).toBe(0);
    expect(
      await prisma.subscription.findUnique({ where: { id: subscriptionId } }),
    ).toMatchObject({
      status: 'active',
      currentPeriodEnd: new Date('2026-03-31T10:30:00.000Z'),
    });
  });

  it('does not renew a canceled subscription', async () => {
    const subscriptionId = await subscribe('tok_success');
    await request(app.getHttpServer())
      .post(`/subscriptions/${subscriptionId}/cancel`)
      .expect(200);
    clock.set(new Date('2026-03-01T00:00:00.000Z'));

    const summary = await app.get(SubscriptionRenewalRunner).run();

    expect(summary.found).toBe(0);
    expect(await prisma.charge.count({ where: { subscriptionId } })).toBe(1);
  });
});
