import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { FakeLlmProvider } from '../../src/llm/fake-llm.provider.js';
import { LlmProvider } from '../../src/llm/index.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import {
  LOG_DESTINATION,
  type LogDestination,
} from '../../src/shared/logging/log-destination.js';
import { CapturedLogs } from '../support/captured-logs.js';
import { createTestApp } from '../support/create-test-app.js';
import { seedCustomerWithPaidCharge } from '../support/seed-payment-history.js';

vi.hoisted(() => {
  process.env['LOG_LEVEL'] = 'info';
});

const CUSTOMER_NAME = 'Zelda Quixotelli Marcante';
const CUSTOMER_EMAIL = 'zelda.quixotelli.marcante@example.org';
const PLAN_NAME = 'Platinum Unobtainium Annual Deluxe';
const CARD_TOKEN = 'tok_success';
const CONCURRENT_REQUESTS = 5;
const SLOW_PROVIDER_MS = 150;

const VALID_OUTPUT = {
  summary: 'Customer pays on time.',
  paymentBehavior: 'on_time',
  riskLevel: 'low',
  suggestedAction: 'No action needed.',
};

describe('Customer summary guarantees (e2e)', () => {
  const logs = new CapturedLogs();
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let llm: FakeLlmProvider;

  beforeAll(async () => {
    const { AppModule } = await import('../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LOG_DESTINATION)
      .useValue(logs satisfies LogDestination)
      .compile();
    app = createTestApp(moduleRef);
    app.useLogger(app.get(Logger));
    await app.init();
    prisma = app.get(PrismaService);
    llm = app.get(LlmProvider) as FakeLlmProvider;
  });

  beforeEach(async () => {
    llm.setMode('ok');
    logs.clear();
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const getSummary = (customerId: string) =>
    http().get(`/customers/${customerId}/summary`);

  const providerReplies = (text: string) =>
    vi.spyOn(llm, 'generateJson').mockResolvedValue({
      text,
      model: 'fake-llm',
      inputTokens: null,
      outputTokens: null,
      finishReason: 'STOP',
      latencyMs: 0,
    });

  async function createPayingCustomer() {
    const customer = await http()
      .post('/customers')
      .send({ name: CUSTOMER_NAME, email: CUSTOMER_EMAIL })
      .expect(201);
    const plan = await http()
      .post('/plans')
      .send({ name: PLAN_NAME, amountCents: 4990, interval: 'monthly' })
      .expect(201);
    const customerId = (customer.body as { id: string }).id;
    const planId = (plan.body as { id: string }).id;
    await subscribe(customerId, planId);
    return { customerId, planId };
  }

  const subscribe = (customerId: string, planId: string) =>
    http()
      .post('/subscriptions')
      .send({
        customerId,
        planId,
        paymentMethod: 'card',
        cardToken: CARD_TOKEN,
      })
      .expect(201);

  describe('fallback never breaks the endpoint', () => {
    it.each([
      ['the provider errors', 'error'],
      ['the provider times out', 'timeout'],
      ['the provider returns invalid JSON', 'invalid_json'],
    ] as const)(
      'answers 200 with a rule-based fallback when %s',
      async (_label, mode) => {
        const { customerId } = await seedCustomerWithPaidCharge(prisma);
        llm.setMode(mode);

        const response = await getSummary(customerId).expect(200);

        expect(response.body).toMatchObject({
          source: 'fallback',
          paymentBehavior: 'occasional_delays',
          riskLevel: 'medium',
          metrics: { totalPaidCents: 1990, failedAttempts: 0 },
        });
        expect(response.body.summary.length).toBeGreaterThan(0);
        expect(response.body.suggestedAction.length).toBeGreaterThan(0);
      },
    );

    it.each([
      [
        'an enum value outside the schema',
        { ...VALID_OUTPUT, riskLevel: 'catastrophic' },
      ],
      [
        'a missing required field',
        { ...VALID_OUTPUT, suggestedAction: undefined },
      ],
      [
        'a summary longer than the limit',
        { ...VALID_OUTPUT, summary: 'x'.repeat(601) },
      ],
      [
        'a suggested action longer than the limit',
        { ...VALID_OUTPUT, suggestedAction: 'x'.repeat(301) },
      ],
      ['an empty summary', { ...VALID_OUTPUT, summary: '   ' }],
    ])(
      'answers 200 with a rule-based fallback when the provider returns valid JSON with %s',
      async (_label, output) => {
        const { customerId } = await seedCustomerWithPaidCharge(prisma);
        providerReplies(JSON.stringify(output));

        const response = await getSummary(customerId).expect(200);

        expect(response.body).toMatchObject({
          source: 'fallback',
          paymentBehavior: 'occasional_delays',
          riskLevel: 'medium',
          metrics: { totalPaidCents: 1990 },
        });
      },
    );
  });

  describe('metrics always come from code', () => {
    it('replaces a narration with invented numbers by the fallback', async () => {
      const { customerId } = await seedCustomerWithPaidCharge(prisma);
      providerReplies(
        JSON.stringify({
          ...VALID_OUTPUT,
          summary: 'Customer paid 999999 cents with 42 failures.',
        }),
      );

      const response = await getSummary(customerId).expect(200);

      expect(response.body.source).toBe('fallback');
      expect(response.body.summary).not.toContain('999999');
      expect(response.body.metrics).toMatchObject({
        totalPaidCents: 1990,
        failedAttempts: 0,
      });
    });

    it('ignores extra fields the LLM tries to inject and keeps a narration with supported numbers', async () => {
      const { customerId } = await seedCustomerWithPaidCharge(prisma);
      providerReplies(
        JSON.stringify({
          ...VALID_OUTPUT,
          summary: 'Customer paid 19.90 (1990 cents) in 1 period.',
          metrics: {
            totalPaidCents: 999999,
            failedAttempts: 42,
            paymentSuccessRate: 0.01,
          },
          totalPaidCents: 999999,
          failedAttempts: 42,
          creditScore: 12,
        }),
      );

      const response = await getSummary(customerId).expect(200);

      expect(response.body.source).toBe('llm');
      expect(response.body.metrics).toMatchObject({
        totalPaidCents: 1990,
        failedAttempts: 0,
        averageDaysLate: 2,
        paymentSuccessRate: 1,
      });
      expect(Object.keys(response.body.metrics).sort()).toEqual(
        [
          'averageDaysLate',
          'failedAttempts',
          'monthsAsCustomer',
          'paymentSuccessRate',
          'totalPaidCents',
        ].sort(),
      );
    });

    it('does not leak extra LLM fields into the response', async () => {
      const { customerId } = await seedCustomerWithPaidCharge(prisma);
      providerReplies(
        JSON.stringify({
          ...VALID_OUTPUT,
          totalPaidCents: 999999,
          creditScore: 12,
          internalNotes: 'secret',
        }),
      );

      const response = await getSummary(customerId).expect(200);

      expect(Object.keys(response.body).sort()).toEqual(
        [
          'customerId',
          'generatedAt',
          'metrics',
          'paymentBehavior',
          'promptVersion',
          'riskLevel',
          'source',
          'suggestedAction',
          'summary',
        ].sort(),
      );
    });
  });

  describe('the provider never receives personal data', () => {
    it('sends no name, email, plan name, gateway ids or card token', async () => {
      const { customerId } = await createPayingCustomer();
      const customer = await prisma.customer.findUniqueOrThrow({
        where: { id: customerId },
      });
      const subscription = await prisma.subscription.findFirstOrThrow({
        where: { customerId },
      });
      const charge = await prisma.charge.findFirstOrThrow({
        where: { subscriptionId: subscription.id },
      });
      const generate = vi.spyOn(llm, 'generateJson');

      await getSummary(customerId).expect(200);

      const [sent] = generate.mock.calls[0]!;
      const payload = `${sent.systemPrompt}\n${sent.context}`;
      const forbidden = [
        CUSTOMER_NAME,
        'Zelda',
        CUSTOMER_EMAIL,
        'example.org',
        PLAN_NAME,
        'Unobtainium',
        CARD_TOKEN,
        customerId,
        subscription.id,
        charge.id,
        customer.gatewayCustomerId,
        charge.gatewayChargeId,
      ].filter((value): value is string => Boolean(value));
      expect(charge.gatewayChargeId).toBeTruthy();
      for (const value of forbidden) {
        expect(payload).not.toContain(value);
      }
      expect(payload).not.toMatch(/\b(cus|sub|ch)_/);
    });
  });

  describe('cache', () => {
    it('calls the provider once for two requests without a new event', async () => {
      const { customerId } = await seedCustomerWithPaidCharge(prisma);
      const generate = vi.spyOn(llm, 'generateJson');

      await getSummary(customerId).expect(200);
      await getSummary(customerId).expect(200);

      expect(generate).toHaveBeenCalledTimes(1);
    });

    it('calls the provider again and refreshes the metrics after a new payment through the API', async () => {
      const { customerId, planId } = await createPayingCustomer();
      const generate = vi.spyOn(llm, 'generateJson');
      const before = await getSummary(customerId).expect(200);

      await subscribe(customerId, planId);
      const after = await getSummary(customerId).expect(200);

      expect(generate).toHaveBeenCalledTimes(2);
      expect(before.body.metrics.totalPaidCents).toBe(4990);
      expect(after.body.metrics.totalPaidCents).toBe(9980);
    });

    it('calls the provider once for simultaneous requests of the same customer', async () => {
      const { customerId } = await seedCustomerWithPaidCharge(prisma);
      const generate = vi
        .spyOn(llm, 'generateJson')
        .mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, SLOW_PROVIDER_MS));
          return {
            text: JSON.stringify(VALID_OUTPUT),
            model: 'fake-llm',
            inputTokens: null,
            outputTokens: null,
            finishReason: 'STOP',
            latencyMs: SLOW_PROVIDER_MS,
          };
        });

      const responses = await Promise.all(
        Array.from({ length: CONCURRENT_REQUESTS }, () =>
          getSummary(customerId),
        ),
      );

      expect(generate).toHaveBeenCalledTimes(1);
      expect(responses.map((response) => response.status)).toEqual(
        Array(CONCURRENT_REQUESTS).fill(200),
      );
    });
  });

  describe('logging', () => {
    it('logs customer_summary.served without the context or the raw LLM response', async () => {
      const { customerId } = await seedCustomerWithPaidCharge(prisma);
      const rawAnswer = JSON.stringify({
        ...VALID_OUTPUT,
        summary: 'RAW-LLM-MARKER pays always on time.',
      });
      const generate = providerReplies(rawAnswer);

      await getSummary(customerId).expect(200);

      const [sent] = generate.mock.calls[0]!;
      const served = logs
        .lines()
        .filter((line) => line['event'] === 'customer_summary.served');
      expect(served).toHaveLength(1);
      const serialized = JSON.stringify(served[0]);
      expect(serialized).not.toContain(sent.context);
      expect(serialized).not.toContain('paymentTimeline');
      expect(serialized).not.toContain('customerAlias');
      expect(serialized).not.toContain('RAW-LLM-MARKER');
      expect(served[0]).toMatchObject({ customerId, source: 'llm' });
    });
  });
});
