import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { FakeLlmProvider } from '../../src/llm/fake-llm.provider.js';
import { LlmProvider } from '../../src/llm/index.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';
import { createTestApp } from '../support/create-test-app.js';
import {
  insertDeclinedAttempt,
  seedCustomerWithPaidCharge,
} from '../support/seed-payment-history.js';

describe('Customer summary (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let llm: FakeLlmProvider;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = createTestApp(moduleRef);
    setupSwagger(app);
    await app.init();
    prisma = app.get(PrismaService);
    llm = app.get(LlmProvider) as FakeLlmProvider;
  });

  beforeEach(async () => {
    llm.setMode('ok');
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const getSummary = (customerId: string) =>
    request(app.getHttpServer()).get(`/customers/${customerId}/summary`);

  it('returns 404 for an unknown customer', async () => {
    const response = await getSummary('cus_missing').expect(404);

    expect(response.body).toMatchObject({ statusCode: 404 });
  });

  it('serves the LLM summary with the metrics computed from the database', async () => {
    const { customerId } = await seedCustomerWithPaidCharge(prisma);

    const response = await getSummary(customerId).expect(200);

    expect(response.body).toMatchObject({
      customerId,
      source: 'llm',
      promptVersion: 'v2',
      metrics: {
        totalPaidCents: 1990,
        failedAttempts: 0,
        averageDaysLate: 2,
        paymentSuccessRate: 1,
      },
      paymentBehavior: 'on_time',
      riskLevel: 'low',
    });
    expect(typeof response.body.metrics.monthsAsCustomer).toBe('number');
    expect(typeof response.body.summary).toBe('string');
    expect(typeof response.body.suggestedAction).toBe('string');
    expect(Number.isNaN(Date.parse(response.body.generatedAt))).toBe(false);
  });

  it('does not call the provider twice while nothing changed', async () => {
    const { customerId } = await seedCustomerWithPaidCharge(prisma);
    const generate = vi.spyOn(llm, 'generateJson');

    const first = await getSummary(customerId).expect(200);
    const second = await getSummary(customerId).expect(200);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(second.body).toEqual(first.body);
    generate.mockRestore();
  });

  it('generates a new summary after a payment event', async () => {
    const { customerId, chargeId } = await seedCustomerWithPaidCharge(prisma);
    const generate = vi.spyOn(llm, 'generateJson');
    await getSummary(customerId).expect(200);

    await insertDeclinedAttempt(prisma, chargeId);
    const response = await getSummary(customerId).expect(200);

    expect(generate).toHaveBeenCalledTimes(2);
    expect(response.body.metrics.failedAttempts).toBe(1);
    generate.mockRestore();
  });

  it.each(['error', 'timeout', 'invalid_json'] as const)(
    'answers 200 with a fallback when the provider is in %s mode',
    async (mode) => {
      const { customerId } = await seedCustomerWithPaidCharge(prisma);
      llm.setMode(mode);

      const response = await getSummary(customerId).expect(200);

      expect(response.body).toMatchObject({
        source: 'fallback',
        metrics: { totalPaidCents: 1990 },
        paymentBehavior: 'occasional_delays',
        riskLevel: 'medium',
      });
    },
  );

  it('documents the endpoint in the OpenAPI document', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(
      response.body.paths['/customers/{id}/summary'].get.responses,
    ).toHaveProperty('404');
  });
});
