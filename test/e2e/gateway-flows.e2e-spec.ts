import { readFile, rm } from 'node:fs/promises';
import { INestApplication, Logger } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { FakeGatewayAdapter } from '../../src/gateway/fake/fake-gateway.adapter.js';
import { GatewayUnavailableError } from '../../src/gateway/index.js';
import { PaymentGateway } from '../../src/gateway/payment-gateway.port.js';
import { LossyPaymentGateway } from '../../src/gateway/testing/lossy-payment-gateway.js';
import { StubPaymentGateway } from '../../src/gateway/testing/stub-payment-gateway.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';
import { createTestApp } from '../support/create-test-app.js';

interface GatewayFile {
  customers: Record<string, unknown>[];
  charges: Record<string, unknown>[];
}

describe('Gateway and charging flows (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FixedClock;

  async function bootstrap(
    configure: (builder: TestingModuleBuilder) => TestingModuleBuilder = (
      builder,
    ) => builder,
  ) {
    clock = new FixedClock(new Date('2026-01-31T10:30:00.000Z'));
    const moduleRef = await configure(
      Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(Clock)
        .useValue(clock),
    ).compile();
    app = createTestApp(moduleRef);
    setupSwagger(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
  }

  beforeEach(async () => {
    await rm(process.env['FAKE_GATEWAY_DATA_FILE']!, { force: true });
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function createCustomer() {
    const response = await http()
      .post('/customers')
      .send({ name: 'Ana', email: 'ana@example.com' })
      .expect(201);
    return response.body as { id: string };
  }

  async function createPlan() {
    const response = await http()
      .post('/plans')
      .send({ name: 'Basic', amountCents: 1990, interval: 'monthly' })
      .expect(201);
    return response.body as { id: string };
  }

  async function subscribe(cardToken: string) {
    const customer = await createCustomer();
    const plan = await createPlan();
    const response = await http().post('/subscriptions').send({
      customerId: customer.id,
      planId: plan.id,
      paymentMethod: 'card',
      cardToken,
    });
    return { customer, plan, response };
  }

  async function readGatewayFile() {
    const content = await readFile(
      process.env['FAKE_GATEWAY_DATA_FILE']!,
      'utf8',
    );
    return JSON.parse(content) as GatewayFile;
  }

  describe('with the fake gateway', () => {
    beforeEach(async () => {
      await bootstrap();
    });

    it('declines an unknown card token with invalid_token and leaves the subscription past_due', async () => {
      const { response } = await subscribe('tok_unknown');

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        status: 'past_due',
        latestCharge: { status: 'failed', failureReason: 'invalid_token' },
      });
      expect(await prisma.paymentAttempt.findMany()).toEqual([
        expect.objectContaining({
          result: 'declined',
          failureReason: 'invalid_token',
        }),
      ]);
    });

    it('records customer and both gateway charges in the fake json file after create and retry', async () => {
      const { customer, response } = await subscribe('tok_fail_then_success');
      const chargeId = response.body.latestCharge.id as string;

      await http().post(`/charges/${chargeId}/retry`).expect(200);

      const stored = await readGatewayFile();
      expect(stored.customers).toEqual([
        expect.objectContaining({
          externalRef: customer.id,
          email: 'ana@example.com',
        }),
      ]);
      expect(stored.charges).toEqual([
        expect.objectContaining({
          externalRef: chargeId,
          status: 'failed',
          failureReason: 'insufficient_funds',
          amountCents: 1990,
        }),
        expect.objectContaining({
          externalRef: chargeId,
          status: 'paid',
          amountCents: 1990,
        }),
      ]);
      const attempts = await prisma.paymentAttempt.findMany();
      expect(attempts).toHaveLength(2);
      expect(stored.charges.map(({ id }) => id)).toEqual(
        expect.arrayContaining(attempts.map((a) => a.gatewayChargeId)),
      );
    });
  });

  describe('with an unavailable gateway', () => {
    let gateway: StubPaymentGateway;

    beforeEach(async () => {
      gateway = new StubPaymentGateway();
      await bootstrap((builder) =>
        builder.overrideProvider(PaymentGateway).useValue(gateway),
      );
    });

    it('answers 503 and persists nothing when the gateway customer cannot be created', async () => {
      gateway.failCustomerCreationWith(new GatewayUnavailableError('down'));

      const { customer, response } = await subscribe('tok_success');

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({ statusCode: 503 });
      expect(await prisma.subscription.count()).toBe(0);
      expect(await prisma.charge.count()).toBe(0);
      expect(
        (
          await prisma.customer.findUniqueOrThrow({
            where: { id: customer.id },
          })
        ).gatewayCustomerId,
      ).toBeNull();
    });

    it('answers 201 with a pending charge and an incomplete subscription when the charge cannot be created', async () => {
      gateway.failChargeCreationWith(new GatewayUnavailableError('down'));

      const { response } = await subscribe('tok_success');

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        status: 'incomplete',
        latestCharge: { status: 'pending', amountCents: 1990 },
      });
      expect(await prisma.paymentAttempt.count()).toBe(0);
    });

    it('answers 200 keeping the charge pending and the subscription past_due when retry cannot reach the gateway', async () => {
      gateway.respondWith({
        status: 'failed',
        failureReason: 'insufficient_funds',
      });
      const { response } = await subscribe('tok_insufficient_funds');
      const chargeId = response.body.latestCharge.id as string;
      gateway.failChargeCreationWith(new GatewayUnavailableError('down'));

      const retried = await http().post(`/charges/${chargeId}/retry`);

      expect(retried.status).toBe(200);
      expect(retried.body.charge).toMatchObject({
        id: chargeId,
        status: 'pending',
        attemptCount: 1,
      });
      expect(retried.body.subscription.status).toBe('past_due');
    });
  });

  describe('with a gateway that loses responses', () => {
    let gateway: LossyPaymentGateway;

    beforeEach(async () => {
      await bootstrap((builder) =>
        builder.overrideProvider(PaymentGateway).useFactory({
          inject: [FakeGatewayAdapter],
          factory: (fake: FakeGatewayAdapter) => {
            gateway = new LossyPaymentGateway(fake);
            return gateway;
          },
        }),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    const LEASE_SECONDS = 30;
    const advancePastLease = () =>
      clock.set(new Date(clock.now().getTime() + (LEASE_SECONDS + 1) * 1000));

    it('answers 409 while the lost attempt is within its lease', async () => {
      gateway.loseNextResponse();
      const { response } = await subscribe('tok_success');
      const chargeId = response.body.latestCharge.id as string;

      const retried = await http().post(`/charges/${chargeId}/retry`);

      expect(response.body).toMatchObject({
        status: 'incomplete',
        latestCharge: { status: 'pending' },
      });
      expect(retried.status).toBe(409);
      expect((await readGatewayFile()).charges).toHaveLength(1);
    });

    it('reconciles a stranded pending charge after the lease without charging twice', async () => {
      gateway.loseNextResponse();
      const { response } = await subscribe('tok_success');
      const chargeId = response.body.latestCharge.id as string;
      advancePastLease();

      const retried = await http()
        .post(`/charges/${chargeId}/retry`)
        .expect(200);

      expect(retried.body.charge).toMatchObject({
        id: chargeId,
        status: 'paid',
        attemptCount: 1,
      });
      expect(retried.body.subscription.status).toBe('active');
      const stored = (await readGatewayFile()).charges;
      expect(stored).toEqual([
        expect.objectContaining({
          externalRef: chargeId,
          idempotencyKey: `${chargeId}:1`,
        }),
      ]);
      expect(await prisma.paymentAttempt.findMany()).toEqual([
        expect.objectContaining({ gatewayChargeId: stored[0]?.['id'] }),
      ]);
    });

    it('records the payment and logs an error when the subscription is canceled while the retry is in flight', async () => {
      const errorLog = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const { response } = await subscribe('tok_fail_then_success');
      const subscriptionId = response.body.id as string;
      const chargeId = response.body.latestCharge.id as string;
      gateway.runAfterCharge(async () => {
        await http()
          .post(`/subscriptions/${subscriptionId}/cancel`)
          .expect(200);
      });

      const retried = await http()
        .post(`/charges/${chargeId}/retry`)
        .expect(200);

      expect(retried.body.charge.status).toBe('paid');
      expect(retried.body.subscription.status).toBe('canceled');
      expect(await prisma.paymentAttempt.count()).toBe(2);
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining(`${chargeId}`),
      );
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining(subscriptionId),
      );
    });
  });
});
