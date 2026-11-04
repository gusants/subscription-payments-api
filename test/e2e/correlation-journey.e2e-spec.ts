import { rm } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { CHARGE_RETRIES_QUEUE } from '../../src/modules/billing-queue/billing-queue.constants.js';
import { retryJobId } from '../../src/modules/billing-queue/domain/retry-job-id.js';
import { Clock } from '../../src/shared/clock/index.js';
import { FixedClock } from '../../src/shared/clock/testing/fixed-clock.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import {
  LOG_DESTINATION,
  type LogDestination,
} from '../../src/shared/logging/log-destination.js';
import { CapturedLogs, type LogLine } from '../support/captured-logs.js';
import { createTestApp } from '../support/create-test-app.js';
import { WEBHOOK_PATH } from '../support/gateway-webhook-fixtures.js';

vi.hoisted(() => {
  process.env['WORKERS_ENABLED'] = 'true';
  process.env['LOG_LEVEL'] = 'info';
  process.env['FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED'] = 'true';
  process.env['FAKE_GATEWAY_WEBHOOK_DELAY_MS'] = '400';
});

const WORKER_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 100;
const JOURNEY_ID = 'journey-4f2a9c71-e2e';
const CARD_TOKEN = 'tok_fail_then_success';
const CUSTOMER_EMAIL = 'ana.correlation@example.com';
const GENERATED_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

describe('Following a payment by correlation id (e2e)', () => {
  const originalWebhookUrl = process.env['FAKE_GATEWAY_WEBHOOK_URL'];
  const logs = new CapturedLogs();
  let appHandler: RequestListener = (_request, response) => {
    response.writeHead(503).end();
  };
  let server: Server;
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    server = createServer(
      (incoming: IncomingMessage, outgoing: ServerResponse) =>
        appHandler(incoming, outgoing),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    process.env['FAKE_GATEWAY_WEBHOOK_URL'] =
      `http://127.0.0.1:${port}${WEBHOOK_PATH}`;
    const { AppModule } = await import('../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue(new FixedClock(new Date('2026-01-31T10:30:00.000Z')))
      .overrideProvider(LOG_DESTINATION)
      .useValue(logs satisfies LogDestination)
      .compile();
    app = createTestApp(moduleRef);
    app.useLogger(app.get(Logger));
    await app.init();
    appHandler = app.getHttpAdapter().getInstance() as RequestListener;
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
    logs.clear();
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => server.close(resolve));
    if (originalWebhookUrl === undefined) {
      delete process.env['FAKE_GATEWAY_WEBHOOK_URL'];
    } else process.env['FAKE_GATEWAY_WEBHOOK_URL'] = originalWebhookUrl;
  });

  const http = () => request(app.getHttpServer());

  async function subscribe(correlationHeader: string) {
    const customer = await http()
      .post('/customers')
      .send({ name: 'Ana', email: CUSTOMER_EMAIL })
      .expect(201);
    const plan = await http()
      .post('/plans')
      .send({ name: 'Basic', amountCents: 1990, interval: 'monthly' })
      .expect(201);
    return http()
      .post('/subscriptions')
      .set('x-correlation-id', correlationHeader)
      .send({
        customerId: customer.body.id,
        planId: plan.body.id,
        paymentMethod: 'card',
        cardToken: CARD_TOKEN,
      })
      .expect(201);
  }

  const eventLines = (): LogLine[] =>
    logs.lines().filter((line) => typeof line['event'] === 'string');

  const eventNamesOf = (correlationId: string): string[] =>
    eventLines()
      .filter((line) => line['correlationId'] === correlationId)
      .map((line) => line['event'] as string);

  const indexOfEvent = (lines: LogLine[], event: string, eventType?: string) =>
    lines.findIndex(
      (line) =>
        line['event'] === event &&
        (eventType === undefined || line['eventType'] === eventType),
    );

  it('tok_fail_then_success — whole journey — logs every step under the same correlation id in order', async () => {
    const created = await subscribe(JOURNEY_ID);
    expect(created.headers['x-correlation-id']).toBe(JOURNEY_ID);
    const retryJob = await app
      .get<Queue>(getQueueToken(CHARGE_RETRIES_QUEUE))
      .getJob(retryJobId(created.body.latestCharge.id as string, 1));
    expect(retryJob?.data).toMatchObject({
      correlationId: JOURNEY_ID,
      publishDelayMs: expect.any(Number),
    });
    await http().post('/dev/retries/run-now').expect(200);
    await vi.waitFor(
      () => {
        const lines = eventLines();
        expect(
          indexOfEvent(lines, 'webhook.received', 'charge.paid'),
        ).toBeGreaterThanOrEqual(0);
      },
      { timeout: WORKER_TIMEOUT_MS, interval: POLL_INTERVAL_MS },
    );

    const lines = eventLines();
    const journey = lines.filter(
      (line) => line['correlationId'] === JOURNEY_ID,
    );
    const journeyEvents = journey.map((line) => line['event']);
    const position = (event: string) => journeyEvents.indexOf(event);
    expect(
      lines.filter((line) => line['correlationId'] !== JOURNEY_ID),
    ).toEqual([]);
    expect(position('charge.created')).toBeGreaterThanOrEqual(0);
    expect(position('charge.attempt.failed')).toBeGreaterThan(
      position('charge.created'),
    );
    expect(position('charge.retry.scheduled')).toBeGreaterThan(
      position('charge.attempt.failed'),
    );
    expect(position('charge.paid')).toBeGreaterThan(
      position('charge.retry.scheduled'),
    );
    expect(
      journey.filter(
        (line) =>
          line['event'] === 'subscription.status_changed' &&
          line['to'] === 'active',
      ),
    ).toHaveLength(1);
    const activated = journey.findIndex(
      (line) =>
        line['event'] === 'subscription.status_changed' &&
        line['to'] === 'active',
    );
    expect(activated).toBeGreaterThan(position('charge.paid'));
    expect(
      indexOfEvent(journey, 'webhook.received', 'charge.paid'),
    ).toBeGreaterThan(activated);
  });

  it('tok_fail_then_success — whole journey — never prints the card token or the customer email', async () => {
    await subscribe(JOURNEY_ID);
    await http().post('/dev/retries/run-now').expect(200);
    await vi.waitFor(
      () =>
        expect(
          indexOfEvent(eventLines(), 'webhook.received', 'charge.paid'),
        ).toBeGreaterThanOrEqual(0),
      { timeout: WORKER_TIMEOUT_MS, interval: POLL_INTERVAL_MS },
    );

    const raw = logs.raw();

    expect(raw).not.toContain(CARD_TOKEN);
    expect(raw).not.toContain(CUSTOMER_EMAIL);
  });

  it('customer search by e-mail — request logged — keeps the e-mail out of the logs', async () => {
    await subscribe(JOURNEY_ID);
    logs.clear();

    const found = await http()
      .get('/customers')
      .query({ search: CUSTOMER_EMAIL })
      .expect(200);

    expect(found.body.data).toHaveLength(1);
    const completed = logs
      .lines()
      .find((line) => line['msg'] === 'request completed');
    expect(completed?.['req']).toMatchObject({
      method: 'GET',
      url: '/customers?[Redacted]',
    });
    const raw = logs.raw();
    expect(raw).not.toContain(CUSTOMER_EMAIL);
    expect(raw).not.toContain(encodeURIComponent(CUSTOMER_EMAIL));
    expect(raw).not.toContain(CUSTOMER_EMAIL.split('@')[0]);
  });

  it('invalid x-correlation-id — subscription created — replaces it with a generated id shown in the response and the logs', async () => {
    const response = await subscribe('bad id!');

    const generated = response.headers['x-correlation-id'] as string;
    expect(generated).toMatch(GENERATED_ID_PATTERN);
    expect(generated).not.toBe('bad id!');
    expect(eventNamesOf(generated)).toContain('charge.created');
  });
});
