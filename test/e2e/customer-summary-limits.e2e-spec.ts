import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedCustomerWithPaidCharge } from '../support/seed-payment-history.js';

describe('Customer summary local LLM budget (e2e)', () => {
  const originalLimit = process.env['LLM_MAX_CALLS_PER_MINUTE'];
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env['LLM_MAX_CALLS_PER_MINUTE'] = '1';
    const { AppModule } = await import('../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    if (originalLimit === undefined) {
      delete process.env['LLM_MAX_CALLS_PER_MINUTE'];
    } else {
      process.env['LLM_MAX_CALLS_PER_MINUTE'] = originalLimit;
    }
  });

  it('serves the fallback instead of calling the model once the process budget is spent', async () => {
    const first = await seedCustomerWithPaidCharge(prisma);
    const second = await seedCustomerWithPaidCharge(prisma);

    const answered = await request(app.getHttpServer())
      .get(`/customers/${first.customerId}/summary`)
      .expect(200);
    const limited = await request(app.getHttpServer())
      .get(`/customers/${second.customerId}/summary`)
      .expect(200);

    expect(answered.body.source).toBe('llm');
    expect(limited.body.source).toBe('fallback');
  });
});
