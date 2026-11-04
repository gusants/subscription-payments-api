import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { BillingQueueModule } from '../../src/modules/billing-queue/billing-queue.module.js';
import { AppConfigModule } from '../../src/shared/config/app-config.module.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { createTestApp } from '../support/create-test-app.js';
import { findRetryJob, runRetryJob } from '../support/charge-retry-jobs.js';

describe('Dev retries run-now (e2e)', () => {
  const apps: INestApplication<App>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  async function startFullApp() {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const app = createTestApp<App>(moduleRef);
    await app.init();
    apps.push(app);
    return app;
  }

  async function startQueueOnlyApp(env: Record<string, unknown>) {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, BillingQueueModule.register(env)],
    }).compile();
    const app = createTestApp<App>(moduleRef);
    await app.init();
    apps.push(app);
    return app;
  }

  it('promotes the delayed dunning retry so it can run now', async () => {
    const app = await startFullApp();
    const prisma = app.get(PrismaService);
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
    await app.get<Queue>(getQueueToken('charge-retries')).drain(true);
    const http = request(app.getHttpServer());
    const customer = await http
      .post('/customers')
      .send({ name: 'Ana', email: 'ana@example.com' })
      .expect(201);
    const plan = await http
      .post('/plans')
      .send({ name: 'Basic', amountCents: 1990, interval: 'monthly' })
      .expect(201);
    const subscription = await http
      .post('/subscriptions')
      .send({
        customerId: customer.body.id,
        planId: plan.body.id,
        paymentMethod: 'card',
        cardToken: 'tok_fail_then_success',
      })
      .expect(201);
    const chargeId = subscription.body.latestCharge.id as string;
    expect(await (await findRetryJob(app, chargeId, 1))?.getState()).toBe(
      'delayed',
    );

    const response = await http.post('/dev/retries/run-now').expect(200);

    expect(response.body).toEqual({ promoted: 1 });
    expect(await (await findRetryJob(app, chargeId, 1))?.getState()).toBe(
      'waiting',
    );
    await runRetryJob(app, chargeId, 1);
    expect(
      await prisma.subscription.findUnique({
        where: { id: subscription.body.id as string },
      }),
    ).toMatchObject({ status: 'active' });
  });

  it('answers 404 in production', async () => {
    const app = await startQueueOnlyApp({ NODE_ENV: 'production' });

    await request(app.getHttpServer()).post('/dev/retries/run-now').expect(404);
  });

  it('is served in production when the flag is explicitly true', async () => {
    const app = await startQueueOnlyApp({
      NODE_ENV: 'production',
      DEV_ROUTES_ENABLED: 'true',
    });

    await request(app.getHttpServer()).post('/dev/retries/run-now').expect(200);
  });

  it('answers 404 outside production when the flag is explicitly false', async () => {
    const app = await startQueueOnlyApp({
      NODE_ENV: 'development',
      DEV_ROUTES_ENABLED: 'false',
    });

    await request(app.getHttpServer()).post('/dev/retries/run-now').expect(404);
  });
});
