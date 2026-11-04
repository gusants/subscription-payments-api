import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { ChargeReconciliationRunner } from '../../src/modules/charges/charge-reconciliation-runner.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { createTestApp } from '../support/create-test-app.js';

describe('Charge reconciliation (e2e)', () => {
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

  async function subscribe() {
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
        cardToken: 'tok_success',
      })
      .expect(201);
    return {
      subscriptionId: response.body.id as string,
      chargeId: response.body.latestCharge.id as string,
    };
  }

  async function strandCharge(chargeId: string) {
    await prisma.paymentAttempt.deleteMany({ where: { chargeId } });
    await prisma.charge.update({
      where: { id: chargeId },
      data: { status: 'pending', paidAt: null, gatewayChargeId: null },
    });
  }

  it('settles a stuck pending card charge from what the gateway already holds', async () => {
    const { subscriptionId, chargeId } = await subscribe();
    await strandCharge(chargeId);
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'incomplete' },
    });
    clock.set(new Date('2026-01-31T10:40:00.000Z'));

    const summary = await app.get(ChargeReconciliationRunner).run();

    expect(summary).toMatchObject({ stalePending: 1, checked: 1, failed: 0 });
    expect(
      await prisma.charge.findUnique({ where: { id: chargeId } }),
    ).toMatchObject({ status: 'paid' });
    expect(
      await prisma.subscription.findUnique({ where: { id: subscriptionId } }),
    ).toMatchObject({ status: 'active' });
  });

  it('asks the gateway about a stuck charge on a canceled subscription and applies what it holds', async () => {
    const { subscriptionId, chargeId } = await subscribe();
    await request(app.getHttpServer())
      .post(`/subscriptions/${subscriptionId}/cancel`)
      .expect(200);
    await strandCharge(chargeId);
    clock.set(new Date('2026-01-31T10:40:00.000Z'));

    const summary = await app.get(ChargeReconciliationRunner).run();

    expect(summary).toMatchObject({ stalePending: 1, checked: 1, failed: 0 });
    expect(
      await prisma.charge.findUnique({ where: { id: chargeId } }),
    ).toMatchObject({ status: 'paid' });
    expect(
      await prisma.subscription.findUnique({ where: { id: subscriptionId } }),
    ).toMatchObject({ status: 'canceled' });
  });

  it('leaves a charge inside the stale window alone', async () => {
    const { chargeId } = await subscribe();
    await strandCharge(chargeId);
    clock.set(new Date('2026-01-31T10:34:00.000Z'));

    const summary = await app.get(ChargeReconciliationRunner).run();

    expect(summary.stalePending).toBe(0);
  });
});
