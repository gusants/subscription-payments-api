import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/shared/clock/clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';
import { createTestApp } from '../support/create-test-app.js';

describe('Metrics (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = createTestApp(moduleRef);
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

  const overview = (query = '') =>
    request(app.getHttpServer()).get(`/metrics/overview${query}`);

  const seedSubscription = async (
    planId: string,
    status: 'active' | 'past_due' | 'canceled',
    canceledAt?: Date,
  ) => {
    const customer = await prisma.customer.create({
      data: {
        id: generateId(ID_PREFIXES.customer),
        name: 'Ana',
        email: `${generateId(ID_PREFIXES.customer)}@example.com`,
      },
    });
    return prisma.subscription.create({
      data: {
        id: generateId(ID_PREFIXES.subscription),
        customerId: customer.id,
        planId,
        paymentMethod: 'card',
        status,
        billingAnchor: new Date('2026-01-10T00:00:00.000Z'),
        currentPeriodStart: new Date('2026-11-10T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-12-10T00:00:00.000Z'),
        canceledAt,
        cancelReason: canceledAt ? 'payment_failed' : undefined,
      },
    });
  };

  it('answers zeros and a null delinquency rate on an empty database, for the current UTC month', async () => {
    const now = app.get(Clock).now();
    const month = now.toISOString().slice(0, 7);

    const response = await overview().expect(200);

    expect(response.body).toEqual({
      from: expect.stringMatching(new RegExp(`^${month}-01T00:00:00.000Z$`)),
      to: expect.stringMatching(new RegExp(`^${month}-\\d{2}T23:59:59.999Z$`)),
      monthlyRecurringRevenueCents: 0,
      activeSubscriptions: 0,
      pastDueSubscriptions: 0,
      delinquencyRate: null,
      revenueByMonth: [{ month, revenueCents: 0 }],
      subscriptionsByStatus: {
        incomplete: 0,
        active: 0,
        past_due: 0,
        canceled: 0,
      },
    });
  });

  it('computes the overview from the stored subscriptions and charges', async () => {
    const monthly = await prisma.plan.create({
      data: {
        id: generateId(ID_PREFIXES.plan),
        name: 'Monthly',
        interval: 'monthly',
        amountCents: 1000,
      },
    });
    const yearly = await prisma.plan.create({
      data: {
        id: generateId(ID_PREFIXES.plan),
        name: 'Yearly',
        interval: 'yearly',
        amountCents: 12_000,
      },
    });
    const first = await seedSubscription(monthly.id, 'active');
    await seedSubscription(monthly.id, 'active');
    await seedSubscription(yearly.id, 'active');
    await seedSubscription(monthly.id, 'past_due');
    await seedSubscription(
      monthly.id,
      'canceled',
      new Date('2026-11-20T00:00:00.000Z'),
    );
    await prisma.charge.create({
      data: {
        id: generateId(ID_PREFIXES.charge),
        subscriptionId: first.id,
        amountCents: 1000,
        method: 'card',
        status: 'paid',
        dueDate: new Date('2026-11-10T00:00:00.000Z'),
        periodStart: new Date('2026-11-10T00:00:00.000Z'),
        periodEnd: new Date('2026-12-10T00:00:00.000Z'),
        paidAt: new Date('2026-11-10T00:00:00.000Z'),
      },
    });

    const response = await overview('?from=2026-10-01&to=2026-11-30').expect(
      200,
    );

    expect(response.body).toEqual({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-11-30T23:59:59.999Z',
      monthlyRecurringRevenueCents: 3000,
      activeSubscriptions: 3,
      pastDueSubscriptions: 1,
      delinquencyRate: 0.4,
      revenueByMonth: [
        { month: '2026-10', revenueCents: 0 },
        { month: '2026-11', revenueCents: 1000 },
      ],
      subscriptionsByStatus: {
        incomplete: 0,
        active: 3,
        past_due: 1,
        canceled: 1,
      },
    });
  });

  it.each([
    ['?from=2026-11-01'],
    ['?to=2026-11-30'],
    ['?from=2026-11-30&to=2026-11-01'],
    ['?from=2026-01-01&to=2027-06-01'],
    ['?from=yesterday&to=today'],
    ['?from=2026-02-30&to=2026-03-01'],
  ])('answers 400 for the invalid query %s', async (query) => {
    const response = await overview(query).expect(400);

    expect(response.body).toMatchObject({ statusCode: 400 });
  });

  it('documents the endpoint in the OpenAPI document', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(response.body.paths['/metrics/overview'].get.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'from' }),
        expect.objectContaining({ name: 'to' }),
      ]),
    );
  });
});
