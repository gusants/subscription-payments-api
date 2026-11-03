import { readFile, rm } from 'node:fs/promises';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { GatewayModule } from '../../src/gateway/gateway.module.js';
import { AppConfigModule } from '../../src/shared/config/app-config.module.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';

interface GatewayData {
  customers: unknown[];
  charges: unknown[];
}

const readGatewayData = async (): Promise<GatewayData> =>
  JSON.parse(
    await readFile(process.env['FAKE_GATEWAY_DATA_FILE']!, 'utf8'),
  ) as GatewayData;

describe('Fake gateway reset (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
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

  async function subscribeNewCustomer(email: string) {
    const customer = await http()
      .post('/customers')
      .send({ name: 'Ana', email })
      .expect(201);
    const plan = await http()
      .post('/plans')
      .send({ name: 'Basic', amountCents: 1990, interval: 'monthly' })
      .expect(201);
    return http()
      .post('/subscriptions')
      .send({
        customerId: customer.body.id,
        planId: plan.body.id,
        paymentMethod: 'card',
        cardToken: 'tok_success',
      })
      .expect(201);
  }

  it('empties the gateway data and answers 204', async () => {
    await subscribeNewCustomer('ana@example.com');
    expect((await readGatewayData()).charges).toHaveLength(1);

    const response = await http().post('/fake-gateway/reset').expect(204);

    expect(response.body).toEqual({});
    expect(await readGatewayData()).toEqual({
      customers: [],
      charges: [],
      events: [],
    });
  });

  it('still charges a new subscription after a reset', async () => {
    await subscribeNewCustomer('ana@example.com');
    await http().post('/fake-gateway/reset').expect(204);

    const response = await subscribeNewCustomer('bia@example.com');

    expect(response.body).toMatchObject({
      status: 'active',
      latestCharge: { status: 'paid' },
    });
    expect((await readGatewayData()).charges).toHaveLength(1);
  });

  it('documents the endpoint under the fake-gateway tag', async () => {
    const response = await http().get('/docs-json').expect(200);

    expect(response.body.paths['/fake-gateway/reset'].post.tags).toEqual([
      'fake-gateway',
    ]);
  });

  describe('outside development', () => {
    async function createGatewayApp(env: Record<string, unknown>) {
      const moduleRef = await Test.createTestingModule({
        imports: [AppConfigModule, GatewayModule.register(env)],
      }).compile();
      const gatewayApp = moduleRef.createNestApplication();
      await gatewayApp.init();
      return gatewayApp;
    }

    it('answers 404 when NODE_ENV is production', async () => {
      const production = await createGatewayApp({
        NODE_ENV: 'production',
        PAYMENT_GATEWAY: 'fake',
      });

      await request(production.getHttpServer())
        .post('/fake-gateway/reset')
        .expect(404);

      await production.close();
    });

    it('serves the route when NODE_ENV is not production', async () => {
      const development = await createGatewayApp({
        NODE_ENV: 'development',
        PAYMENT_GATEWAY: 'fake',
      });

      await request(development.getHttpServer())
        .post('/fake-gateway/reset')
        .expect(204);

      await development.close();
    });
  });
});
