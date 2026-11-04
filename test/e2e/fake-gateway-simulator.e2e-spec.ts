import { readFile, rm } from 'node:fs/promises';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { FakeGatewaySimulator } from '../../src/gateway/fake/fake-gateway.simulator.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';

interface GatewayFile {
  charges: { externalRef: string; status: string }[];
}

describe('Fake gateway simulator routes (e2e)', () => {
  const startedAt = new Date('2026-01-31T10:30:00.000Z');
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FixedClock;

  beforeAll(async () => {
    clock = new FixedClock(startedAt);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    setupSwagger(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    clock.set(startedAt);
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

  const readGatewayCharges = async () =>
    (
      JSON.parse(
        await readFile(process.env['FAKE_GATEWAY_DATA_FILE']!, 'utf8'),
      ) as GatewayFile
    ).charges;

  async function subscribe(
    paymentMethod: 'card' | 'pix' | 'boleto',
    cardToken?: string,
  ) {
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
        ...(cardToken && { cardToken }),
      })
      .expect(201);
    return response.body as {
      id: string;
      latestCharge: { id: string };
    };
  }

  describe.each(['pix', 'boleto'] as const)('%s charge', (method) => {
    it('pays the pending gateway charge by our charge id and leaves ours to the webhook', async () => {
      const { latestCharge } = await subscribe(method);

      const response = await http()
        .post(`/fake-gateway/charges/${latestCharge.id}/pay`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: expect.stringMatching(/^gch_/),
        externalRef: latestCharge.id,
        method,
        status: 'paid',
        amountCents: 1990,
        paymentInstructions: { type: method },
      });
      expect(await readGatewayCharges()).toEqual([
        expect.objectContaining({
          externalRef: latestCharge.id,
          status: 'paid',
        }),
      ]);
      expect(
        (
          await prisma.charge.findUniqueOrThrow({
            where: { id: latestCharge.id },
          })
        ).status,
      ).toBe('pending');
    });

    it('expires the pending gateway charge', async () => {
      const { latestCharge } = await subscribe(method);

      const response = await http()
        .post(`/fake-gateway/charges/${latestCharge.id}/expire`)
        .expect(200);

      expect(response.body).toMatchObject({
        externalRef: latestCharge.id,
        status: 'expired',
      });
      expect(await readGatewayCharges()).toEqual([
        expect.objectContaining({ status: 'expired' }),
      ]);
    });

    it('answers 409 when the charge is no longer pending', async () => {
      const { latestCharge } = await subscribe(method);
      await http().post(`/fake-gateway/charges/${latestCharge.id}/pay`);

      await http()
        .post(`/fake-gateway/charges/${latestCharge.id}/pay`)
        .expect(409);
      await http()
        .post(`/fake-gateway/charges/${latestCharge.id}/expire`)
        .expect(409);
    });
  });

  it('answers 404 for a charge the gateway does not know', async () => {
    await http().post('/fake-gateway/charges/ch_missing/pay').expect(404);
    await http().post('/fake-gateway/charges/ch_missing/expire').expect(404);
  });

  it('answers 409 for a card charge', async () => {
    const { latestCharge } = await subscribe('card', 'tok_success');

    await http()
      .post(`/fake-gateway/charges/${latestCharge.id}/pay`)
      .expect(409);
  });

  it('expires pending charges by themselves once their expiry passes', async () => {
    await subscribe('pix');
    clock.set(new Date('2026-01-31T11:00:00.000Z'));

    await app.get(FakeGatewaySimulator).expireDue();

    expect(await readGatewayCharges()).toEqual([
      expect.objectContaining({ status: 'expired' }),
    ]);
  });

  it('retrying a pending pix charge reconciles it without sending it again', async () => {
    const { latestCharge } = await subscribe('pix');
    clock.set(new Date('2026-01-31T10:31:00.000Z'));

    const response = await http()
      .post(`/charges/${latestCharge.id}/retry`)
      .expect(200);

    expect(response.body.charge).toMatchObject({
      id: latestCharge.id,
      status: 'pending',
    });
    expect(await readGatewayCharges()).toHaveLength(1);
  });

  describe('POST /fake-gateway/subscriptions/:id/card', () => {
    it('replaces the stored card token so the next attempt can be forced to decline', async () => {
      const subscription = await subscribe('card', 'tok_success');

      await http()
        .post(`/fake-gateway/subscriptions/${subscription.id}/card`)
        .send({ cardToken: 'tok_insufficient_funds' })
        .expect(204);

      expect(
        (
          await prisma.subscription.findUniqueOrThrow({
            where: { id: subscription.id },
          })
        ).cardToken,
      ).toBe('tok_insufficient_funds');
    });

    it('answers 404 for an unknown subscription', async () => {
      await http()
        .post('/fake-gateway/subscriptions/sub_missing/card')
        .send({ cardToken: 'tok_success' })
        .expect(404);
    });

    it('answers 400 for a blank token', async () => {
      const subscription = await subscribe('card', 'tok_success');

      await http()
        .post(`/fake-gateway/subscriptions/${subscription.id}/card`)
        .send({ cardToken: '  ' })
        .expect(400);
    });

    it('answers 422 for a subscription that is not paid by card', async () => {
      const subscription = await subscribe('pix');

      await http()
        .post(`/fake-gateway/subscriptions/${subscription.id}/card`)
        .send({ cardToken: 'tok_success' })
        .expect(422);
    });
  });

  it('documents the routes under the fake-gateway tag', async () => {
    const { body } = await http().get('/docs-json').expect(200);

    for (const path of [
      '/fake-gateway/charges/{id}/pay',
      '/fake-gateway/charges/{id}/expire',
      '/fake-gateway/subscriptions/{id}/card',
    ]) {
      expect(body.paths[path].post.tags).toEqual(['fake-gateway']);
    }
  });
});
