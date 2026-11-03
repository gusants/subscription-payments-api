import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';

describe('Customers (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupSwagger(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const createCustomer = (body: object) => http().post('/customers').send(body);

  const names = (body: { data: { name: string }[] }) =>
    body.data.map(({ name }) => name);

  async function insertSubscription(
    customerId: string,
    planId: string,
    status: 'incomplete' | 'active' | 'past_due' | 'canceled',
  ) {
    return prisma.subscription.create({
      data: {
        id: generateId(ID_PREFIXES.subscription),
        customerId,
        planId,
        paymentMethod: 'pix',
        status,
        billingAnchor: new Date('2026-11-03T00:00:00.000Z'),
        currentPeriodStart: new Date('2026-11-03T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-12-03T00:00:00.000Z'),
      },
    });
  }

  async function insertPlan() {
    return prisma.plan.create({
      data: {
        id: generateId(ID_PREFIXES.plan),
        name: 'Basic',
        amountCents: 1990,
        interval: 'monthly',
      },
    });
  }

  describe('POST /customers', () => {
    it('creates a customer with a normalized email', async () => {
      const response = await createCustomer({
        name: '  Ana Souza ',
        email: ' Ana@Example.COM ',
      }).expect(201);

      expect(response.body).toEqual({
        id: expect.stringMatching(/^cus_/),
        name: 'Ana Souza',
        email: 'ana@example.com',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });

    it('answers 409 for a duplicate email regardless of case', async () => {
      await createCustomer({ name: 'Ana', email: 'ana@example.com' }).expect(
        201,
      );

      const response = await createCustomer({
        name: 'Other Ana',
        email: 'ANA@example.com',
      }).expect(409);

      expect(response.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: 'Customer with email ana@example.com already exists',
      });
    });

    it('creates only one customer under concurrent duplicate requests', async () => {
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          createCustomer({ name: 'Race', email: 'race@example.com' }),
        ),
      );

      expect(responses.filter(({ status }) => status === 201)).toHaveLength(1);
      expect(responses.filter(({ status }) => status === 409)).toHaveLength(4);
      expect(await prisma.customer.count()).toBe(1);
    });

    it.each([
      { name: '', email: 'a@example.com' },
      { name: 'Ana', email: 'not-an-email' },
      { name: 'Ana' },
    ])('rejects invalid body %j with 400', async (body) => {
      const response = await createCustomer(body).expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        message: 'Validation failed',
      });
    });
  });

  describe('GET /customers', () => {
    it('paginates customers', async () => {
      for (const name of ['A', 'B', 'C']) {
        await createCustomer({ name, email: `${name}@example.com` });
      }

      const response = await http()
        .get('/customers?page=2&limit=2')
        .expect(200);

      expect(names(response.body)).toEqual(['C']);
      expect(response.body.meta).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('searches name or email case-insensitively', async () => {
      await createCustomer({ name: 'Ana Souza', email: 'ana@example.com' });
      await createCustomer({ name: 'Bruno', email: 'bruno@souza-corp.io' });
      await createCustomer({ name: 'Carla', email: 'carla@example.com' });

      const response = await http().get('/customers?search=SOUZA').expect(200);

      expect(names(response.body)).toEqual(['Ana Souza', 'Bruno']);
      expect(response.body.meta.total).toBe(2);
    });

    it('treats wildcard characters in search literally', async () => {
      await createCustomer({ name: '100% Real', email: 'real@example.com' });
      await createCustomer({ name: 'Other', email: 'other@example.com' });

      const response = await http()
        .get('/customers')
        .query({ search: '%' })
        .expect(200);

      expect(names(response.body)).toEqual(['100% Real']);
    });

    it('filters by subscription status', async () => {
      const plan = await insertPlan();
      const active = (
        await createCustomer({ name: 'Active', email: 'active@example.com' })
      ).body;
      const canceled = (
        await createCustomer({
          name: 'Canceled',
          email: 'canceled@example.com',
        })
      ).body;
      await createCustomer({ name: 'None', email: 'none@example.com' });
      await insertSubscription(active.id, plan.id, 'canceled');
      await insertSubscription(active.id, plan.id, 'active');
      await insertSubscription(canceled.id, plan.id, 'canceled');

      const activeOnly = await http()
        .get('/customers?subscriptionStatus=active')
        .expect(200);
      const canceledOnly = await http()
        .get('/customers?subscriptionStatus=canceled')
        .expect(200);

      expect(names(activeOnly.body)).toEqual(['Active']);
      expect(activeOnly.body.meta.total).toBe(1);
      expect(names(canceledOnly.body)).toEqual(['Active', 'Canceled']);
    });

    it('combines search and subscription status', async () => {
      const plan = await insertPlan();
      const ana = (
        await createCustomer({ name: 'Ana', email: 'ana@example.com' })
      ).body;
      const bia = (
        await createCustomer({ name: 'Bia', email: 'bia@example.com' })
      ).body;
      await insertSubscription(ana.id, plan.id, 'active');
      await insertSubscription(bia.id, plan.id, 'active');

      const response = await http()
        .get('/customers?search=ana&subscriptionStatus=active')
        .expect(200);

      expect(names(response.body)).toEqual(['Ana']);
    });

    it.each([
      'subscriptionStatus=paused',
      'limit=0',
      'limit=101',
      'page=0',
      'search=',
    ])('rejects invalid query %s with 400', async (query) => {
      await http().get(`/customers?${query}`).expect(400);
    });
  });

  describe('GET /customers/:id', () => {
    it('returns the customer with its subscriptions summary', async () => {
      const plan = await insertPlan();
      const customer = (
        await createCustomer({ name: 'Ana', email: 'ana@example.com' })
      ).body;
      const subscription = await insertSubscription(
        customer.id,
        plan.id,
        'active',
      );

      const response = await http()
        .get(`/customers/${customer.id}`)
        .expect(200);

      expect(response.body).toEqual({
        ...customer,
        subscriptions: [
          {
            id: subscription.id,
            planId: plan.id,
            status: 'active',
            currentPeriodEnd: '2026-12-03T00:00:00.000Z',
          },
        ],
      });
    });

    it('returns an empty subscriptions list for a new customer', async () => {
      const customer = (
        await createCustomer({ name: 'Ana', email: 'ana@example.com' })
      ).body;

      const response = await http()
        .get(`/customers/${customer.id}`)
        .expect(200);

      expect(response.body.subscriptions).toEqual([]);
    });

    it('answers 404 with the standard error body for an unknown id', async () => {
      const response = await http().get('/customers/cus_missing').expect(404);

      expect(response.body).toEqual({
        statusCode: 404,
        error: 'Not Found',
        message: 'Customer cus_missing not found',
      });
    });
  });
});
