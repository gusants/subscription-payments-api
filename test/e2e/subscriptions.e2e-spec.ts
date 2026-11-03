import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';

describe('Subscriptions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(Clock)
      .useValue(new FixedClock(new Date('2026-01-31T10:30:00.000Z')))
      .compile();
    app = moduleRef.createNestApplication();
    setupSwagger(app);
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

  const http = () => request(app.getHttpServer());

  async function createCustomer() {
    const response = await http()
      .post('/customers')
      .send({ name: 'Ana', email: 'ana@example.com' })
      .expect(201);
    return response.body as { id: string };
  }

  async function createPlan(interval: 'monthly' | 'yearly' = 'monthly') {
    const response = await http()
      .post('/plans')
      .send({ name: 'Basic', amountCents: 1990, interval })
      .expect(201);
    return response.body as { id: string };
  }

  async function createSubscription() {
    const customer = await createCustomer();
    const plan = await createPlan();
    const response = await http()
      .post('/subscriptions')
      .send({ customerId: customer.id, planId: plan.id, paymentMethod: 'pix' })
      .expect(201);
    return { customer, plan, subscription: response.body };
  }

  describe('POST /subscriptions', () => {
    it('creates an incomplete subscription clamping the period end to month length', async () => {
      const customer = await createCustomer();
      const plan = await createPlan();

      const response = await http()
        .post('/subscriptions')
        .send({
          customerId: customer.id,
          planId: plan.id,
          paymentMethod: 'card',
        })
        .expect(201);

      expect(response.body).toEqual({
        id: expect.stringMatching(/^sub_/),
        customerId: customer.id,
        planId: plan.id,
        paymentMethod: 'card',
        status: 'incomplete',
        billingAnchor: '2026-01-31T10:30:00.000Z',
        currentPeriodStart: '2026-01-31T10:30:00.000Z',
        currentPeriodEnd: '2026-02-28T10:30:00.000Z',
        canceledAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('answers 404 for an unknown customer', async () => {
      const plan = await createPlan();

      const response = await http()
        .post('/subscriptions')
        .send({
          customerId: 'cus_missing',
          planId: plan.id,
          paymentMethod: 'pix',
        })
        .expect(404);

      expect(response.body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Customer cus_missing not found',
      });
    });

    it('answers 404 for an unknown plan', async () => {
      const customer = await createCustomer();

      const response = await http()
        .post('/subscriptions')
        .send({
          customerId: customer.id,
          planId: 'plan_missing',
          paymentMethod: 'pix',
        })
        .expect(404);

      expect(response.body.message).toBe('Plan plan_missing not found');
    });

    it('answers 422 for an inactive plan', async () => {
      const customer = await createCustomer();
      const plan = await createPlan();
      await prisma.plan.update({
        where: { id: plan.id },
        data: { active: false },
      });

      const response = await http()
        .post('/subscriptions')
        .send({
          customerId: customer.id,
          planId: plan.id,
          paymentMethod: 'pix',
        })
        .expect(422);

      expect(response.body).toEqual({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: `Plan ${plan.id} is not active`,
      });
    });

    it.each([
      {},
      { customerId: 'cus_1', planId: 'plan_1' },
      { customerId: 'cus_1', planId: 'plan_1', paymentMethod: 'cash' },
      { customerId: '', planId: 'plan_1', paymentMethod: 'pix' },
    ])('rejects invalid body %j with 400', async (body) => {
      const response = await http()
        .post('/subscriptions')
        .send(body)
        .expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        message: 'Validation failed',
      });
    });
  });

  describe('GET /subscriptions/:id', () => {
    it('returns the subscription', async () => {
      const { subscription } = await createSubscription();

      const response = await http()
        .get(`/subscriptions/${subscription.id}`)
        .expect(200);

      expect(response.body).toEqual(subscription);
    });

    it('answers 404 for an unknown id', async () => {
      const response = await http()
        .get('/subscriptions/sub_missing')
        .expect(404);

      expect(response.body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Subscription sub_missing not found',
      });
    });
  });

  describe('POST /subscriptions/:id/cancel', () => {
    it('cancels the subscription and stamps canceledAt', async () => {
      const { subscription } = await createSubscription();

      const response = await http()
        .post(`/subscriptions/${subscription.id}/cancel`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: subscription.id,
        status: 'canceled',
        canceledAt: expect.any(String),
      });
    });

    it('answers 409 when cancelling twice', async () => {
      const { subscription } = await createSubscription();
      await http().post(`/subscriptions/${subscription.id}/cancel`).expect(200);

      const response = await http()
        .post(`/subscriptions/${subscription.id}/cancel`)
        .expect(409);

      expect(response.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: 'Cannot transition subscription from canceled to canceled',
      });
    });

    it('cancels only once under concurrent requests', async () => {
      const { subscription } = await createSubscription();

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          http().post(`/subscriptions/${subscription.id}/cancel`),
        ),
      );

      expect(responses.filter(({ status }) => status === 200)).toHaveLength(1);
      expect(responses.filter(({ status }) => status === 409)).toHaveLength(4);
    });

    it('answers 404 for an unknown id', async () => {
      await http().post('/subscriptions/sub_missing/cancel').expect(404);
    });
  });

  describe('customer integration', () => {
    it('lists the created subscription in the customer detail', async () => {
      const { customer, subscription } = await createSubscription();

      const response = await http()
        .get(`/customers/${customer.id}`)
        .expect(200);

      expect(response.body.subscriptions).toEqual([
        {
          id: subscription.id,
          planId: subscription.planId,
          status: 'incomplete',
          currentPeriodEnd: subscription.currentPeriodEnd,
        },
      ]);
    });

    it('finds the customer by subscriptionStatus=canceled after cancel', async () => {
      const { customer, subscription } = await createSubscription();
      await http().post(`/subscriptions/${subscription.id}/cancel`).expect(200);

      const canceled = await http()
        .get('/customers?subscriptionStatus=canceled')
        .expect(200);
      const incomplete = await http()
        .get('/customers?subscriptionStatus=incomplete')
        .expect(200);

      expect(canceled.body.data.map(({ id }: { id: string }) => id)).toEqual([
        customer.id,
      ]);
      expect(incomplete.body.data).toEqual([]);
    });
  });
});
