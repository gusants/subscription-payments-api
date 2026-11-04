import { rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  gatewayWebhookPayloadSchema,
  SIGNATURE_HEADER,
  verify,
  type GatewayWebhookPayload,
} from '../../src/gateway/index.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { createTestApp } from '../support/create-test-app.js';

interface Delivery {
  rawBody: string;
  signature: string;
}

const waitUntil = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('Fake gateway webhook delivery (e2e)', () => {
  const secret = process.env['GATEWAY_WEBHOOK_SECRET']!;
  const deliveries: Delivery[] = [];
  const overriddenEnv = [
    'FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED',
    'FAKE_GATEWAY_WEBHOOK_URL',
    'FAKE_GATEWAY_WEBHOOK_DELAY_MS',
    'FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE',
  ];
  const originalEnv = Object.fromEntries(
    overriddenEnv.map((name) => [name, process.env[name]]),
  );
  let receiver: Server;
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    receiver = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        deliveries.push({
          rawBody: Buffer.concat(chunks).toString('utf8'),
          signature: String(incoming.headers[SIGNATURE_HEADER]),
        });
        outgoing.writeHead(200).end();
      });
    });
    await new Promise<void>((resolve) =>
      receiver.listen(0, '127.0.0.1', resolve),
    );
    const { port } = receiver.address() as AddressInfo;
    process.env['FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED'] = 'true';
    process.env['FAKE_GATEWAY_WEBHOOK_URL'] = `http://127.0.0.1:${port}/hook`;
    process.env['FAKE_GATEWAY_WEBHOOK_DELAY_MS'] = '0';
    process.env['FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE'] = '1';
    const { AppModule } = await import('../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = createTestApp(moduleRef);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    deliveries.length = 0;
    await rm(process.env['FAKE_GATEWAY_DATA_FILE']!, { force: true });
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => receiver.close(resolve));
    for (const name of overriddenEnv) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  });

  const http = () => request(app.getHttpServer());

  async function subscribe(paymentMethod: 'card' | 'pix') {
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
    return response.body as { latestCharge: { id: string } };
  }

  const parsed = ({ rawBody }: Delivery): GatewayWebhookPayload =>
    gatewayWebhookPayloadSchema.parse(JSON.parse(rawBody));

  it('delivers a signed charge.paid event, twice with the same id when duplication is certain', async () => {
    const { latestCharge } = await subscribe('pix');
    await http()
      .post(`/fake-gateway/charges/${latestCharge.id}/pay`)
      .expect(200);

    await waitUntil(() => deliveries.length >= 2);

    expect(deliveries).toHaveLength(2);
    for (const delivery of deliveries) {
      expect(verify(delivery.rawBody, delivery.signature, secret).valid).toBe(
        true,
      );
    }
    const [first, second] = deliveries.map(parsed);
    expect(first).toMatchObject({
      type: 'charge.paid',
      data: {
        charge: { externalRef: latestCharge.id, method: 'pix', status: 'paid' },
      },
    });
    expect(second?.id).toBe(first?.id);
  });

  it('delivers the event of a card charge decided at creation', async () => {
    const { latestCharge } = await subscribe('card');

    await waitUntil(() => deliveries.length >= 1);

    expect(parsed(deliveries[0]!)).toMatchObject({
      id: expect.stringMatching(/^evt_/),
      type: 'charge.paid',
      data: { charge: { externalRef: latestCharge.id, method: 'card' } },
    });
  });
});
