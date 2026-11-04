import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { FakeGatewayAdapter } from '../../src/gateway/fake/fake-gateway.adapter.js';
import { PaymentGateway } from '../../src/gateway/payment-gateway.port.js';
import { LossyPaymentGateway } from '../../src/gateway/testing/lossy-payment-gateway.js';
import { ChargeReconciliationRunner } from '../../src/modules/charges/charge-reconciliation-runner.js';
import { SubscriptionRenewalRunner } from '../../src/modules/charges/subscription-renewal-runner.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { findRetryJob, runRetryJob } from '../support/charge-retry-jobs.js';
import { createTestApp } from '../support/create-test-app.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_WINDOW_MS = 6 * 60 * 1000;
const afterDays = (from: Date, days: number, extraMs = 0) =>
  new Date(from.getTime() + days * DAY_MS + extraMs);

describe('Reconciliation recovery (e2e)', () => {
  const startedAt = new Date('2026-01-31T10:30:00.000Z');
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FixedClock;
  let gateway: LossyPaymentGateway;

  beforeEach(async () => {
    clock = new FixedClock(startedAt);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(PaymentGateway)
      .useFactory({
        inject: [FakeGatewayAdapter],
        factory: (fake: FakeGatewayAdapter) => {
          gateway = new LossyPaymentGateway(fake);
          return gateway;
        },
      })
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

  async function subscribeAsAsynchronous(method: 'pix' | 'boleto') {
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
    const subscriptionId = response.body.id as string;
    const chargeId = response.body.latestCharge.id as string;
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { paymentMethod: method, cardToken: null },
    });
    return { subscriptionId, chargeId };
  }

  const chargesOf = (subscriptionId: string) =>
    prisma.charge.findMany({
      where: { subscriptionId },
      orderBy: [{ retryCount: 'asc' }, { createdAt: 'asc' }],
    });

  it('an expired ancestor of an expired reissue — swept while the next retry is still delayed — is not reissued out of calendar', async () => {
    const { subscriptionId, chargeId } =
      await subscribeAsAsynchronous('boleto');
    await prisma.charge.update({
      where: { id: chargeId },
      data: {
        status: 'expired',
        method: 'boleto',
        paidAt: null,
        firstFailedAt: startedAt,
      },
    });
    clock.set(afterDays(startedAt, 1));
    await runRetryJob(app, chargeId, 1);
    const [, reissued] = await chargesOf(subscriptionId);
    await prisma.charge.update({
      where: { id: reissued!.id },
      data: { status: 'expired' },
    });
    clock.set(afterDays(startedAt, 2));
    const reconciliation = app.get(ChargeReconciliationRunner);

    const sweptBeforeCalendar = await reconciliation.run();

    expect(sweptBeforeCalendar.dunningFollowUps).toBe(0);
    expect(await findRetryJob(app, chargeId, 1)).toBeUndefined();
    expect(await chargesOf(subscriptionId)).toHaveLength(2);

    clock.set(afterDays(startedAt, 3, STALE_WINDOW_MS));
    const sweptAtCalendar = await reconciliation.run();

    expect(sweptAtCalendar.dunningFollowUps).toBe(1);
    expect(await findRetryJob(app, chargeId, 1)).toBeUndefined();
    expect(await findRetryJob(app, reissued!.id, 2)).toBeDefined();
    await expect(runRetryJob(app, chargeId, 1)).resolves.toBeUndefined();
    await runRetryJob(app, reissued!.id, 2);
    expect(
      (await chargesOf(subscriptionId)).map(({ retryCount }) => retryCount),
    ).toEqual([0, 1, 2]);
  });

  it('a pix renewal that never reached the gateway — gateway back — is sent by the reconciliation sweep', async () => {
    const { subscriptionId } = await subscribeAsAsynchronous('pix');
    clock.set(new Date('2026-03-01T00:00:00.000Z'));
    gateway.setUnavailable(true);

    const renewal = await app.get(SubscriptionRenewalRunner).run();

    expect(renewal).toMatchObject({
      found: 1,
      renewed: 0,
      awaitingReconciliation: 1,
      failed: 0,
    });
    const [, stranded] = await chargesOf(subscriptionId);
    expect(stranded).toMatchObject({
      status: 'pending',
      gatewayChargeId: null,
    });
    gateway.setUnavailable(false);
    clock.set(new Date(clock.now().getTime() + STALE_WINDOW_MS));

    const reconciliation = await app.get(ChargeReconciliationRunner).run();

    expect(reconciliation).toMatchObject({ stalePending: 1, checked: 1 });
    expect(
      await prisma.charge.findUniqueOrThrow({ where: { id: stranded!.id } }),
    ).toMatchObject({
      status: 'pending',
      gatewayChargeId: expect.any(String),
      paymentInstructions: expect.anything(),
    });
    expect(await app.get(SubscriptionRenewalRunner).run()).toMatchObject({
      found: 0,
    });
  });

  it('a boleto reissue whose technical attempts ran out — gateway back — is sent by the reconciliation sweep', async () => {
    const { subscriptionId, chargeId } =
      await subscribeAsAsynchronous('boleto');
    await prisma.charge.update({
      where: { id: chargeId },
      data: {
        status: 'expired',
        method: 'boleto',
        paidAt: null,
        firstFailedAt: startedAt,
      },
    });
    clock.set(afterDays(startedAt, 1));
    gateway.setUnavailable(true);

    await expect(runRetryJob(app, chargeId, 1)).rejects.toThrow('gateway down');

    const [, stranded] = await chargesOf(subscriptionId);
    expect(stranded).toMatchObject({
      status: 'pending',
      retryCount: 1,
      gatewayChargeId: null,
    });
    gateway.setUnavailable(false);
    clock.set(afterDays(startedAt, 1, STALE_WINDOW_MS));

    await app.get(ChargeReconciliationRunner).run();

    expect(
      await prisma.charge.findUniqueOrThrow({ where: { id: stranded!.id } }),
    ).toMatchObject({
      status: 'pending',
      retryCount: 1,
      gatewayChargeId: expect.any(String),
    });
    expect(await chargesOf(subscriptionId)).toHaveLength(2);
  });
});
