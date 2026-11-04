import { rm } from 'node:fs/promises';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import type { GatewayWebhookPayload } from '../../src/gateway/index.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { createTestApp } from '../support/create-test-app.js';
import {
  chargeEvent,
  signedHeaders,
  storedWebhookPayloads,
  WEBHOOK_PATH,
} from '../support/gateway-webhook-fixtures.js';

describe('POST /webhooks/gateway processing (e2e)', () => {
  const secret = process.env['GATEWAY_WEBHOOK_SECRET']!;
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function subscribe(paymentMethod: 'card' | 'pix' | 'boleto') {
    const customer = await http()
      .post('/customers')
      .send({ name: 'Ana', email: 'ana@example.com' })
      .expect(201);
    const plan = await http()
      .post('/plans')
      .send({ name: 'Basic', amountCents: 1990, interval: 'monthly' })
      .expect(201);
    const response = await http()
      .post('/subscriptions')
      .send({
        customerId: customer.body.id,
        planId: plan.body.id,
        paymentMethod,
        ...(paymentMethod === 'card' && { cardToken: 'tok_success' }),
      })
      .expect(201);
    return response.body as {
      id: string;
      latestCharge: { id: string };
    };
  }

  const deliver = (payload: GatewayWebhookPayload) => {
    const rawBody = JSON.stringify(payload);
    return http()
      .post(WEBHOOK_PATH)
      .set(signedHeaders(rawBody, secret))
      .send(rawBody);
  };

  const subscriptionStatus = async (id: string) =>
    (await http().get(`/subscriptions/${id}`).expect(200)).body.status;

  const chargeStatus = async (id: string) =>
    (await prisma.charge.findUniqueOrThrow({ where: { id } })).status;

  const outcomes = async () =>
    (await prisma.webhookEvent.findMany()).map(({ outcome }) => outcome);

  it('settles a paid pix charge and activates the subscription', async () => {
    const subscription = await subscribe('pix');
    await http()
      .post(`/fake-gateway/charges/${subscription.latestCharge.id}/pay`)
      .expect(200);
    const [paid] = await storedWebhookPayloads();

    const response = await deliver(paid!).expect(200);

    expect(response.body).toEqual({ received: true });
    expect(await chargeStatus(subscription.latestCharge.id)).toBe('paid');
    expect(await subscriptionStatus(subscription.id)).toBe('active');
    expect(await outcomes()).toEqual(['applied']);
    expect(await prisma.paymentAttempt.count()).toBe(1);
  });

  it('applies the same event delivered twice only once', async () => {
    const subscription = await subscribe('pix');
    await http()
      .post(`/fake-gateway/charges/${subscription.latestCharge.id}/pay`)
      .expect(200);
    const [paid] = await storedWebhookPayloads();

    await deliver(paid!).expect(200);
    const second = await deliver(paid!).expect(200);

    expect(second.body).toEqual({ received: true });
    expect(await outcomes()).toEqual(['applied']);
    expect(await prisma.paymentAttempt.count()).toBe(1);
    expect(
      (
        await prisma.charge.findUniqueOrThrow({
          where: { id: subscription.latestCharge.id },
        })
      ).attemptCount,
    ).toBe(1);
  });

  it('applies the same event delivered concurrently only once', async () => {
    const subscription = await subscribe('pix');
    await http()
      .post(`/fake-gateway/charges/${subscription.latestCharge.id}/pay`)
      .expect(200);
    const [paid] = await storedWebhookPayloads();

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => deliver(paid!)),
    );

    expect(responses.map(({ status }) => status)).toEqual(Array(6).fill(200));
    expect(await outcomes()).toEqual(['applied']);
    expect(await prisma.paymentAttempt.count()).toBe(1);
  });

  it('records the webhook of a card charge already settled as ignored_duplicate_state', async () => {
    const subscription = await subscribe('card');
    const [paid] = await storedWebhookPayloads();
    expect(paid?.type).toBe('charge.paid');

    await deliver(paid!).expect(200);

    expect(await outcomes()).toEqual(['ignored_duplicate_state']);
    expect(await prisma.paymentAttempt.count()).toBe(1);
    expect(await subscriptionStatus(subscription.id)).toBe('active');
  });

  it('cancels a subscription whose first boleto expired', async () => {
    const subscription = await subscribe('boleto');
    await http()
      .post(`/fake-gateway/charges/${subscription.latestCharge.id}/expire`)
      .expect(200);
    const [expired] = await storedWebhookPayloads();

    await deliver(expired!).expect(200);

    expect(await chargeStatus(subscription.latestCharge.id)).toBe('expired');
    expect(await subscriptionStatus(subscription.id)).toBe('canceled');
    expect(await outcomes()).toEqual(['applied']);
  });

  it('answers 200 and records requires_refund for a paid event after the charge expired', async () => {
    const subscription = await subscribe('boleto');
    await http()
      .post(`/fake-gateway/charges/${subscription.latestCharge.id}/expire`)
      .expect(200);
    const [expired] = await storedWebhookPayloads();
    await deliver(expired!).expect(200);

    const late = chargeEvent('charge.paid', {
      id: expired!.data.charge.id,
      externalRef: subscription.latestCharge.id,
      method: 'boleto',
      customerId: expired!.data.charge.customerId,
      amountCents: expired!.data.charge.amountCents,
    });
    await deliver(late).expect(200);

    expect(await outcomes()).toEqual(
      expect.arrayContaining(['applied', 'requires_refund']),
    );
    expect(await chargeStatus(subscription.latestCharge.id)).toBe('expired');
    expect(await subscriptionStatus(subscription.id)).toBe('canceled');
    expect(await prisma.paymentAttempt.count()).toBe(0);
  });

  it('answers 200 and records ignored_unknown_charge for an unknown charge', async () => {
    await deliver(
      chargeEvent('charge.paid', { id: 'gch_x', externalRef: 'ch_nope' }),
    ).expect(200);

    expect(await outcomes()).toEqual(['ignored_unknown_charge']);
  });
});
