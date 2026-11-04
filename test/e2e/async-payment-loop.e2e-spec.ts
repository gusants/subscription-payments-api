import { rm } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { FakeGatewaySimulator } from '../../src/gateway/fake/fake-gateway.simulator.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { createTestApp } from '../support/create-test-app.js';
import { WEBHOOK_PATH } from '../support/gateway-webhook-fixtures.js';

const BOLETO_EXPIRATION_SECONDS = 259200;
const PIX_EXPIRATION_SECONDS = 1800;

const waitUntil = async (condition: () => Promise<boolean> | boolean) => {
  const deadline = Date.now() + 10000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

describe('Asynchronous payment methods, full webhook loop (e2e)', () => {
  const overriddenEnv = [
    'FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED',
    'FAKE_GATEWAY_WEBHOOK_URL',
    'FAKE_GATEWAY_WEBHOOK_DELAY_MS',
    'FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE',
  ];
  const originalEnv = Object.fromEntries(
    overriddenEnv.map((name) => [name, process.env[name]]),
  );
  const startedAt = new Date('2026-01-31T10:30:00.000Z');
  let webhookRequests = 0;
  let appHandler: RequestListener = (_request, response) => {
    response.writeHead(503).end();
  };
  let server: Server;
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let clock: FixedClock;

  beforeAll(async () => {
    server = createServer(
      (incoming: IncomingMessage, outgoing: ServerResponse) => {
        if (incoming.url === WEBHOOK_PATH) webhookRequests += 1;
        appHandler(incoming, outgoing);
      },
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    process.env['FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED'] = 'true';
    process.env['FAKE_GATEWAY_WEBHOOK_URL'] =
      `http://127.0.0.1:${port}${WEBHOOK_PATH}`;
    process.env['FAKE_GATEWAY_WEBHOOK_DELAY_MS'] = '0';
    process.env['FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE'] = '1';
    clock = new FixedClock(startedAt);
    const { AppModule } = await import('../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = createTestApp(moduleRef);
    await app.init();
    appHandler = app.getHttpAdapter().getInstance() as RequestListener;
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    webhookRequests = 0;
    clock.set(startedAt);
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
    await new Promise((resolve) => server.close(resolve));
    for (const name of overriddenEnv) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  });

  const http = () => request(app.getHttpServer());

  async function subscribe(paymentMethod: 'pix' | 'boleto') {
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
      })
      .expect(201);
    return response.body as {
      id: string;
      status: string;
      latestCharge: { id: string; status: string };
    };
  }

  const advanceClockBySeconds = (seconds: number) =>
    clock.set(new Date(clock.now().getTime() + seconds * 1000));

  const subscriptionStatus = async (id: string) =>
    (await http().get(`/subscriptions/${id}`).expect(200)).body.status;

  const chargeStatus = async (id: string) =>
    (await prisma.charge.findUniqueOrThrow({ where: { id } })).status;

  const waitForDeliveries = (count: number) =>
    waitUntil(() => webhookRequests >= count);

  it('pix paid by the simulator — webhook delivered twice — activates the subscription with one event row and one attempt', async () => {
    const subscription = await subscribe('pix');
    expect(subscription).toMatchObject({
      status: 'incomplete',
      latestCharge: { status: 'pending' },
    });

    await http()
      .post(`/fake-gateway/charges/${subscription.latestCharge.id}/pay`)
      .expect(200);
    await waitForDeliveries(2);
    await waitUntil(
      async () => (await subscriptionStatus(subscription.id)) === 'active',
    );

    expect(await chargeStatus(subscription.latestCharge.id)).toBe('paid');
    expect(
      (await prisma.webhookEvent.findMany()).map(({ type, outcome }) => ({
        type,
        outcome,
      })),
    ).toEqual([{ type: 'charge.paid', outcome: 'applied' }]);
    expect(await prisma.paymentAttempt.count()).toBe(1);
  });

  it('boleto past its expiration — swept by the fake gateway itself — cancels the first-charge subscription', async () => {
    const subscription = await subscribe('boleto');
    advanceClockBySeconds(BOLETO_EXPIRATION_SECONDS + 1);

    const expired = await app.get(FakeGatewaySimulator).expireDue();
    await waitForDeliveries(2);
    await waitUntil(
      async () =>
        (await chargeStatus(subscription.latestCharge.id)) === 'expired',
    );

    expect(expired).toHaveLength(1);
    expect(await subscriptionStatus(subscription.id)).toBe('canceled');
    expect(
      (await prisma.webhookEvent.findMany()).map(({ type, outcome }) => ({
        type,
        outcome,
      })),
    ).toEqual([{ type: 'charge.expired', outcome: 'applied' }]);
    expect(await prisma.paymentAttempt.count()).toBe(0);
  });

  it('pix before its expiration — sweep runs — leaves the charge pending and sends no webhook', async () => {
    const subscription = await subscribe('pix');
    advanceClockBySeconds(PIX_EXPIRATION_SECONDS - 1);

    const expired = await app.get(FakeGatewaySimulator).expireDue();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(expired).toEqual([]);
    expect(webhookRequests).toBe(0);
    expect(await chargeStatus(subscription.latestCharge.id)).toBe('pending');
    expect(await subscriptionStatus(subscription.id)).toBe('incomplete');
  });

  it('pix past its expiration — swept by the fake gateway itself — cancels the first-charge subscription', async () => {
    const subscription = await subscribe('pix');
    advanceClockBySeconds(PIX_EXPIRATION_SECONDS + 1);

    await app.get(FakeGatewaySimulator).expireDue();
    await waitForDeliveries(1);
    await waitUntil(
      async () => (await subscriptionStatus(subscription.id)) === 'canceled',
    );

    expect(await chargeStatus(subscription.latestCharge.id)).toBe('expired');
  });
});
