import { rm } from 'node:fs/promises';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';
import { findRetryJob, runRetryJob } from '../support/charge-retry-jobs.js';
import { createTestApp } from '../support/create-test-app.js';

describe('Charges (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(Clock)
      .useValue(new FixedClock(new Date('2026-01-31T10:30:00.000Z')))
      .compile();
    app = createTestApp(moduleRef);
    setupSwagger(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await rm(process.env['FAKE_GATEWAY_DATA_FILE']!, { force: true });
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function createCustomer(email = 'ana@example.com') {
    const response = await http()
      .post('/customers')
      .send({ name: 'Ana', email })
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

  async function subscribeWithCard(
    customerId: string,
    planId: string,
    cardToken: string,
  ) {
    const response = await http()
      .post('/subscriptions')
      .send({ customerId, planId, paymentMethod: 'card', cardToken })
      .expect(201);
    return response.body as {
      id: string;
      status: string;
      latestCharge: { id: string };
    };
  }

  async function seedPastDueSubscription(cardToken: string) {
    const customer = await createCustomer();
    const plan = await createPlan();
    const subscription = await subscribeWithCard(
      customer.id,
      plan.id,
      cardToken,
    );
    return {
      customer,
      plan,
      subscription,
      chargeId: subscription.latestCharge.id,
    };
  }

  describe('GET /customers/:id/charges', () => {
    it('answers 404 for an unknown customer', async () => {
      const response = await http()
        .get('/customers/cus_missing/charges')
        .expect(404);

      expect(response.body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Customer cus_missing not found',
      });
    });

    it('returns an empty page for a customer without charges', async () => {
      const customer = await createCustomer();

      const response = await http()
        .get(`/customers/${customer.id}/charges`)
        .expect(200);

      expect(response.body).toEqual({
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });

    it('returns the charge history with its attempts and no gateway data', async () => {
      const { customer, subscription, chargeId } =
        await seedPastDueSubscription('tok_insufficient_funds');

      const response = await http()
        .get(`/customers/${customer.id}/charges`)
        .expect(200);

      expect(response.body.data).toEqual([
        {
          id: chargeId,
          subscriptionId: subscription.id,
          amountCents: 1990,
          method: 'card',
          status: 'failed',
          attemptCount: 1,
          dueDate: '2026-01-31T10:30:00.000Z',
          periodStart: '2026-01-31T10:30:00.000Z',
          periodEnd: '2026-02-28T10:30:00.000Z',
          paidAt: null,
          createdAt: expect.any(String),
          attempts: [
            {
              id: expect.stringMatching(/^pa_/),
              result: 'declined',
              failureReason: 'insufficient_funds',
              createdAt: expect.any(String),
            },
          ],
        },
      ]);
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('gch_');
      expect(body).not.toContain('tok_');
    });

    it('lists charges across subscriptions newest first and paginates them', async () => {
      const customer = await createCustomer();
      const plan = await createPlan();
      const chargeIds: string[] = [];
      for (const cardToken of [
        'tok_success',
        'tok_expired_card',
        'tok_insufficient_funds',
      ]) {
        const subscription = await subscribeWithCard(
          customer.id,
          plan.id,
          cardToken,
        );
        chargeIds.push(subscription.latestCharge.id);
      }
      const other = await createCustomer('bia@example.com');
      await subscribeWithCard(other.id, plan.id, 'tok_success');
      const [oldest, middle, newest] = chargeIds;

      const firstPage = await http()
        .get(`/customers/${customer.id}/charges?page=1&limit=2`)
        .expect(200);
      const secondPage = await http()
        .get(`/customers/${customer.id}/charges?page=2&limit=2`)
        .expect(200);

      const idsOf = (body: { data: { id: string }[] }) =>
        body.data.map(({ id }) => id);
      expect(idsOf(firstPage.body)).toEqual([newest, middle]);
      expect(idsOf(secondPage.body)).toEqual([oldest]);
      expect(firstPage.body.meta).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('rejects an invalid page with 400', async () => {
      const customer = await createCustomer();

      await http().get(`/customers/${customer.id}/charges?page=0`).expect(400);
    });
  });

  describe('POST /charges/:id/retry', () => {
    it('answers 404 for an unknown charge', async () => {
      const response = await http()
        .post('/charges/ch_missing/retry')
        .expect(404);

      expect(response.body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Charge ch_missing not found',
      });
    });

    it('queues the retry answering 202, and the worker run pays the charge and reactivates the subscription with tok_fail_then_success', async () => {
      const { customer, subscription, chargeId } =
        await seedPastDueSubscription('tok_fail_then_success');
      expect(subscription.status).toBe('past_due');
      expect(await (await findRetryJob(app, chargeId, 1))?.getState()).toBe(
        'delayed',
      );

      const response = await http()
        .post(`/charges/${chargeId}/retry`)
        .expect(202);

      expect(response.body).toEqual({
        charge: expect.objectContaining({
          id: chargeId,
          status: 'failed',
          attemptCount: 1,
        }),
        subscription: { id: subscription.id, status: 'past_due' },
      });
      expect(await (await findRetryJob(app, chargeId, 1))?.getState()).toBe(
        'waiting',
      );

      await runRetryJob(app, chargeId, 1);

      const history = await http()
        .get(`/customers/${customer.id}/charges`)
        .expect(200);
      expect(history.body.data[0]).toMatchObject({
        id: chargeId,
        status: 'paid',
        attemptCount: 2,
        paidAt: '2026-01-31T10:30:00.000Z',
        attempts: [
          expect.objectContaining({
            result: 'declined',
            failureReason: 'insufficient_funds',
          }),
          expect.objectContaining({ result: 'succeeded', failureReason: null }),
        ],
      });
      expect(JSON.stringify(history.body)).not.toContain('tok_');
      const stored = await http()
        .get(`/subscriptions/${subscription.id}`)
        .expect(200);
      expect(stored.body.status).toBe('active');
    });

    it('keeps the charge failed and the subscription past_due when the worker run is declined again, scheduling the next retry', async () => {
      const { subscription, chargeId } = await seedPastDueSubscription(
        'tok_insufficient_funds',
      );
      await http().post(`/charges/${chargeId}/retry`).expect(202);

      await runRetryJob(app, chargeId, 1);

      const stored = await prisma.charge.findUniqueOrThrow({
        where: { id: chargeId },
      });
      expect(stored).toMatchObject({
        status: 'failed',
        attemptCount: 2,
        retryCount: 1,
        paidAt: null,
      });
      expect(await prisma.paymentAttempt.count({ where: { chargeId } })).toBe(
        2,
      );
      expect(
        (
          await prisma.subscription.findUniqueOrThrow({
            where: { id: subscription.id },
          })
        ).status,
      ).toBe('past_due');
      expect(await (await findRetryJob(app, chargeId, 2))?.getState()).toBe(
        'delayed',
      );
    });

    it('queues one job however many times the retry is requested and runs the attempt once', async () => {
      const { chargeId } = await seedPastDueSubscription(
        'tok_fail_then_success',
      );

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          http().post(`/charges/${chargeId}/retry`),
        ),
      );
      await runRetryJob(app, chargeId, 1);
      await runRetryJob(app, chargeId, 1);

      expect(responses.map(({ status }) => status)).toEqual([
        202, 202, 202, 202, 202,
      ]);
      expect(await prisma.paymentAttempt.count({ where: { chargeId } })).toBe(
        2,
      );
    });

    it('makes the charge uncollectible and cancels the subscription when the third retry is declined', async () => {
      const { subscription, chargeId } = await seedPastDueSubscription(
        'tok_insufficient_funds',
      );

      for (const attempt of [1, 2, 3]) {
        await runRetryJob(app, chargeId, attempt);
      }

      expect(
        await prisma.charge.findUniqueOrThrow({ where: { id: chargeId } }),
      ).toMatchObject({ status: 'uncollectible', retryCount: 3 });
      expect(
        await http().get(`/subscriptions/${subscription.id}`).expect(200),
      ).toMatchObject({ body: { status: 'canceled' } });
      await http().post(`/charges/${chargeId}/retry`).expect(409);
    });

    it('answers 409 when the charge is already paid', async () => {
      const customer = await createCustomer();
      const plan = await createPlan();
      const subscription = await subscribeWithCard(
        customer.id,
        plan.id,
        'tok_success',
      );

      const response = await http()
        .post(`/charges/${subscription.latestCharge.id}/retry`)
        .expect(409);

      expect(response.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: 'Cannot transition charge from paid to pending',
      });
    });

    it('answers 409 when the subscription is canceled', async () => {
      const { subscription, chargeId } = await seedPastDueSubscription(
        'tok_fail_then_success',
      );
      await http().post(`/subscriptions/${subscription.id}/cancel`).expect(200);

      const response = await http()
        .post(`/charges/${chargeId}/retry`)
        .expect(409);

      expect(response.body.message).toBe(
        'Cannot transition subscription from canceled to active',
      );
      expect(
        (await prisma.charge.findUniqueOrThrow({ where: { id: chargeId } }))
          .status,
      ).toBe('failed');
    });
  });
});
