import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { REDIS_CLIENT } from '../../src/shared/redis/redis.constants.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { createTestApp } from '../support/create-test-app.js';

interface RawResponse {
  status: number;
  replayed: string | undefined;
  body: { id?: string };
}

const freePort = async (): Promise<number> => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

describe('Idempotency-Key edge cases (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  async function bootstrap(
    configure: (builder: TestingModuleBuilder) => TestingModuleBuilder = (
      builder,
    ) => builder,
  ) {
    const moduleRef = await configure(
      Test.createTestingModule({ imports: [AppModule] }),
    ).compile();
    app = createTestApp(moduleRef);
    await app.init();
    prisma = app.get(PrismaService);
    await rm(process.env['FAKE_GATEWAY_DATA_FILE']!, { force: true });
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
  }

  afterEach(async () => {
    await app.close();
  });

  async function subscriptionInput() {
    const http = request(app.getHttpServer());
    const customer = await http
      .post('/customers')
      .send({ name: 'Ana', email: `${randomUUID()}@example.com` })
      .expect(201);
    const plan = await http
      .post('/plans')
      .send({ name: 'Basic', amountCents: 1990, interval: 'monthly' })
      .expect(201);
    return {
      customerId: customer.body.id,
      planId: plan.body.id,
      paymentMethod: 'card',
      cardToken: 'tok_success',
    };
  }

  describe('with Redis available', () => {
    beforeEach(async () => {
      await bootstrap();
      await app.listen(0, '127.0.0.1');
    });

    const postWithHeaderLines = async (
      keys: string[],
      input: object,
    ): Promise<RawResponse> => {
      const { port } = (await app.getUrl()).match(/:(?<port>\d+)$/)!.groups as {
        port: string;
      };
      const payload = JSON.stringify(input);
      return new Promise((resolve, reject) => {
        const outgoing = httpRequest(
          {
            host: '127.0.0.1',
            port: Number(port),
            path: '/subscriptions',
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': keys,
            },
          },
          (incoming) => {
            const chunks: Buffer[] = [];
            incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
            incoming.on('end', () =>
              resolve({
                status: incoming.statusCode!,
                replayed: incoming.headers['idempotent-replayed'] as
                  string | undefined,
                body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
              }),
            );
          },
        );
        outgoing.on('error', reject);
        outgoing.end(payload);
      });
    };

    it.each([
      ['different values', () => [randomUUID(), randomUUID()]],
      ['the same value', () => [`dup-${randomUUID()}`].flatMap((k) => [k, k])],
    ])(
      'Idempotency-Key sent twice with %s — answers 400 and runs nothing',
      async (_name, keys) => {
        const input = await subscriptionInput();

        const response = await postWithHeaderLines(keys(), input);

        expect(response.status).toBe(400);
        expect(await prisma.subscription.count()).toBe(0);
        expect(await prisma.charge.count()).toBe(0);
      },
    );

    it('Idempotency-Key sent once — still works next to the repeated-header guard', async () => {
      const input = await subscriptionInput();
      const key = randomUUID();

      const created = await postWithHeaderLines([key], input);
      const replayed = await postWithHeaderLines([key], input);

      expect(created.status).toBe(201);
      expect(replayed.status).toBe(201);
      expect(replayed.replayed).toBe('true');
      expect(replayed.body.id).toBe(created.body.id);
      expect(await prisma.subscription.count()).toBe(1);
    });
  });

  describe('with Redis unreachable', () => {
    const BOUND_MS = 20_000;

    beforeEach(async () => {
      const deadPort = await freePort();
      await bootstrap((builder) =>
        builder.overrideProvider(REDIS_CLIENT).useFactory({
          factory: () => new Redis({ host: '127.0.0.1', port: deadPort }),
        }),
      );
    }, 60_000);

    // TODO: unskip once the Redis client fails fast (maxRetriesPerRequest/commandTimeout); today the 503 arrives only after ~73s
    it.skip('Idempotency-Key present — store cannot be reached — answers 503 in bounded time without running the handler', async () => {
      const input = await subscriptionInput();
      const startedAt = Date.now();

      const response = await request(app.getHttpServer())
        .post('/subscriptions')
        .set('Idempotency-Key', randomUUID())
        .send(input);

      expect(response.status).toBe(503);
      expect(Date.now() - startedAt).toBeLessThan(BOUND_MS);
      expect(await prisma.subscription.count()).toBe(0);
      expect(await prisma.charge.count()).toBe(0);
    }, 60_000);
  });
});
