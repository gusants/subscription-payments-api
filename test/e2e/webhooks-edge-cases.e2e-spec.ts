import { rm } from 'node:fs/promises';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { FakeGatewayAdapter } from '../../src/gateway/fake/fake-gateway.adapter.js';
import { PaymentGateway } from '../../src/gateway/payment-gateway.port.js';
import { LossyPaymentGateway } from '../../src/gateway/testing/lossy-payment-gateway.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { createTestApp } from '../support/create-test-app.js';
import {
  signedHeaders,
  storedWebhookPayloads,
  WEBHOOK_PATH,
} from '../support/gateway-webhook-fixtures.js';

describe('POST /webhooks/gateway edge cases (e2e)', () => {
  const secret = process.env['GATEWAY_WEBHOOK_SECRET']!;
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let gateway: LossyPaymentGateway;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
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
  });

  beforeEach(async () => {
    await rm(process.env['FAKE_GATEWAY_DATA_FILE']!, { force: true });
    await prisma.webhookEvent.deleteMany();
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
  });

  afterEach(() => {
    gateway.runAfterCharge(() => Promise.resolve());
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('malformed body', () => {
    it.each([
      ['truncated JSON', '{"id":"evt_1","type":'],
      ['plain text', 'not json at all'],
    ])(
      'signed %s — answers 400 and records no event',
      async (_name, rawBody) => {
        const response = await http()
          .post(WEBHOOK_PATH)
          .set(signedHeaders(rawBody, secret))
          .send(rawBody);

        expect(response.status).toBe(400);
        expect(await prisma.webhookEvent.count()).toBe(0);
      },
    );

    it('unsigned truncated JSON — answers 400 and records no event', async () => {
      const response = await http()
        .post(WEBHOOK_PATH)
        .set('content-type', 'application/json')
        .send('{"id":');

      expect(response.status).toBe(400);
      expect(await prisma.webhookEvent.count()).toBe(0);
    });
  });

  describe('webhook that settles the charge before the charge flow records its outcome', () => {
    async function subscribeWithWebhookFirst({
      idempotencyKey,
    }: { idempotencyKey?: string } = {}) {
      const customer = await http()
        .post('/customers')
        .send({ name: 'Ana', email: 'ana@example.com' })
        .expect(201);
      const plan = await http()
        .post('/plans')
        .send({ name: 'Basic', amountCents: 1990, interval: 'monthly' })
        .expect(201);
      let webhookStatus = 0;
      gateway.runAfterCharge(async () => {
        const [paid] = await storedWebhookPayloads();
        const rawBody = JSON.stringify(paid);
        const delivered = await http()
          .post(WEBHOOK_PATH)
          .set(signedHeaders(rawBody, secret))
          .send(rawBody);
        webhookStatus = delivered.status;
      });
      const input = {
        customerId: customer.body.id,
        planId: plan.body.id,
        paymentMethod: 'card',
        cardToken: 'tok_success',
      };
      const response = await http()
        .post('/subscriptions')
        .set(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
        .send(input);
      return { response, webhookStatus, input };
    }

    it('card charge paid by the webhook first — flow records its outcome later — settles exactly once', async () => {
      const { webhookStatus } = await subscribeWithWebhookFirst();

      expect(webhookStatus).toBe(200);
      expect(await prisma.paymentAttempt.count()).toBe(1);
      expect((await prisma.charge.findFirstOrThrow()).attemptCount).toBe(1);
      expect(
        (await prisma.webhookEvent.findMany()).map(({ outcome }) => outcome),
      ).toEqual(['applied']);
      expect((await prisma.subscription.findFirstOrThrow()).status).toBe(
        'active',
      );
      expect((await prisma.charge.findFirstOrThrow()).status).toBe('paid');
    });

    it('card charge paid by the webhook first — the create-subscription request — answers 201 with the paid charge', async () => {
      const { response } = await subscribeWithWebhookFirst();

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('active');
      expect(response.body.latestCharge.status).toBe('paid');
    });

    it('card charge paid by the webhook first — the same Idempotency-Key retried — replays the 201', async () => {
      const key = 'webhook-first-key';
      const first = await subscribeWithWebhookFirst({ idempotencyKey: key });

      const replay = await http()
        .post('/subscriptions')
        .set('Idempotency-Key', key)
        .send(first.input);

      expect(replay.status).toBe(201);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(replay.body.id).toBe(first.response.body.id);
    });
  });
});
