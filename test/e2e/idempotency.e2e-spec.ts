import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';
import { createTestApp } from '../support/create-test-app.js';

describe('Idempotency-Key (e2e)', () => {
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
  const newKey = () => randomUUID();

  async function createCustomer(email: string) {
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

  async function seedSubscriptionInput(cardToken = 'tok_success') {
    const customer = await createCustomer(`${randomUUID()}@example.com`);
    const plan = await createPlan();
    return {
      customerId: customer.id,
      planId: plan.id,
      paymentMethod: 'card',
      cardToken,
    };
  }

  async function seedPastDueCharge() {
    const input = await seedSubscriptionInput('tok_fail_then_success');
    const response = await http()
      .post('/subscriptions')
      .send(input)
      .expect(201);
    return (response.body as { latestCharge: { id: string } }).latestCharge.id;
  }

  async function gatewayCharges() {
    const content = await readFile(
      process.env['FAKE_GATEWAY_DATA_FILE']!,
      'utf8',
    );
    return (JSON.parse(content) as { charges: unknown[] }).charges;
  }

  describe('POST /subscriptions', () => {
    it('creates one subscription and replays the identical response for the same key and body', async () => {
      const input = await seedSubscriptionInput();
      const key = newKey();

      const first = await http()
        .post('/subscriptions')
        .set('Idempotency-Key', key)
        .send(input)
        .expect(201);
      const second = await http()
        .post('/subscriptions')
        .set('Idempotency-Key', key)
        .send({ ...input })
        .expect(201);

      expect(second.body).toEqual(first.body);
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(await prisma.subscription.count()).toBe(1);
      expect(await gatewayCharges()).toHaveLength(1);
    });

    it('answers 422 for the same key with a different body and creates nothing', async () => {
      const input = await seedSubscriptionInput();
      const key = newKey();
      await http()
        .post('/subscriptions')
        .set('Idempotency-Key', key)
        .send(input)
        .expect(201);

      const response = await http()
        .post('/subscriptions')
        .set('Idempotency-Key', key)
        .send({ ...input, paymentMethod: 'pix' })
        .expect(422);

      expect(response.body).toEqual({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Idempotency-Key was already used with a different request',
      });
      expect(await prisma.subscription.count()).toBe(1);
    });

    it('creates one subscription when the same key arrives concurrently', async () => {
      const input = await seedSubscriptionInput();
      const key = newKey();

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          http().post('/subscriptions').set('Idempotency-Key', key).send(input),
        ),
      );

      const created = responses.filter(({ status }) => status === 201);
      const rejected = responses.filter(({ status }) => status === 409);
      expect(created.length + rejected.length).toBe(responses.length);
      expect(
        created.filter(
          ({ headers }) => headers['idempotent-replayed'] === undefined,
        ),
      ).toHaveLength(1);
      expect(await prisma.subscription.count()).toBe(1);
      expect(await gatewayCharges()).toHaveLength(1);
    });

    it('replays a stored 404 for the same key and body', async () => {
      const key = newKey();
      const input = {
        customerId: 'cus_missing',
        planId: 'pln_missing',
        paymentMethod: 'pix',
      };

      const first = await http()
        .post('/subscriptions')
        .set('Idempotency-Key', key)
        .send(input)
        .expect(404);
      const second = await http()
        .post('/subscriptions')
        .set('Idempotency-Key', key)
        .send(input)
        .expect(404);

      expect(second.body).toEqual(first.body);
      expect(second.headers['idempotent-replayed']).toBe('true');
    });

    it('does not store a validation error, so the key works with a corrected body', async () => {
      const input = await seedSubscriptionInput();
      const key = newKey();
      await http()
        .post('/subscriptions')
        .set('Idempotency-Key', key)
        .send({ ...input, paymentMethod: 'nope' })
        .expect(400);

      await http()
        .post('/subscriptions')
        .set('Idempotency-Key', key)
        .send(input)
        .expect(201);

      expect(await prisma.subscription.count()).toBe(1);
    });

    it('answers 400 for an invalid key', async () => {
      const input = await seedSubscriptionInput();

      const response = await http()
        .post('/subscriptions')
        .set('Idempotency-Key', 'x'.repeat(256))
        .send(input)
        .expect(400);

      expect(response.body.message).toBe(
        'Idempotency-Key must be 1 to 255 printable ASCII characters',
      );
      expect(await prisma.subscription.count()).toBe(0);
    });

    it('behaves as before without the header', async () => {
      const input = await seedSubscriptionInput();

      await http().post('/subscriptions').send(input).expect(201);
      const second = await http().post('/subscriptions').send(input);

      expect(second.headers['idempotent-replayed']).toBeUndefined();
    });
  });

  describe('POST /charges/:id/retry', () => {
    it('runs one gateway attempt for the same key twice and replays the response', async () => {
      const chargeId = await seedPastDueCharge();
      const key = newKey();

      const first = await http()
        .post(`/charges/${chargeId}/retry`)
        .set('Idempotency-Key', key)
        .expect(200);
      const second = await http()
        .post(`/charges/${chargeId}/retry`)
        .set('Idempotency-Key', key)
        .expect(200);

      expect(first.body.charge.status).toBe('paid');
      expect(second.body).toEqual(first.body);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(await prisma.paymentAttempt.count({ where: { chargeId } })).toBe(
        2,
      );
    });

    it('replays the stored 409 instead of re-running the retry', async () => {
      const chargeId = await seedPastDueCharge();
      await http().post(`/charges/${chargeId}/retry`).expect(200);
      const key = newKey();

      const first = await http()
        .post(`/charges/${chargeId}/retry`)
        .set('Idempotency-Key', key)
        .expect(409);
      const second = await http()
        .post(`/charges/${chargeId}/retry`)
        .set('Idempotency-Key', key)
        .expect(409);

      expect(second.body).toEqual(first.body);
      expect(second.headers['idempotent-replayed']).toBe('true');
    });

    it('keeps the same key independent across different charges', async () => {
      const firstChargeId = await seedPastDueCharge();
      const secondChargeId = await seedPastDueCharge();
      const key = newKey();

      const first = await http()
        .post(`/charges/${firstChargeId}/retry`)
        .set('Idempotency-Key', key)
        .expect(200);
      const second = await http()
        .post(`/charges/${secondChargeId}/retry`)
        .set('Idempotency-Key', key)
        .expect(200);

      expect(first.body.charge.id).toBe(firstChargeId);
      expect(second.body.charge.id).toBe(secondChargeId);
      expect(second.headers['idempotent-replayed']).toBeUndefined();
      expect(
        await prisma.paymentAttempt.count({
          where: { chargeId: { in: [firstChargeId, secondChargeId] } },
        }),
      ).toBe(4);
    });

    it('runs one attempt when the same key arrives concurrently', async () => {
      const chargeId = await seedPastDueCharge();
      const key = newKey();

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          http().post(`/charges/${chargeId}/retry`).set('Idempotency-Key', key),
        ),
      );

      expect(responses.filter(({ status }) => status === 200)).not.toHaveLength(
        0,
      );
      expect(
        responses.every(({ status }) => status === 200 || status === 409),
      ).toBe(true);
      expect(await prisma.paymentAttempt.count({ where: { chargeId } })).toBe(
        2,
      );
    });
  });
});
