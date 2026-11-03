import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';

describe('Plans (e2e)', () => {
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
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.plan.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const createPlan = (body: object) =>
    request(app.getHttpServer()).post('/plans').send(body);

  describe('POST /plans', () => {
    it('creates a plan', async () => {
      const response = await createPlan({
        name: '  Basic  ',
        amountCents: 1990,
        interval: 'monthly',
      }).expect(201);

      expect(response.body).toEqual({
        id: expect.stringMatching(/^plan_/),
        name: 'Basic',
        amountCents: 1990,
        interval: 'monthly',
        active: true,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(new Date(response.body.createdAt).toISOString()).toBe(
        response.body.createdAt,
      );
    });

    it.each([
      { name: '   ', amountCents: 1000, interval: 'monthly' },
      { name: 'Basic', amountCents: 0, interval: 'monthly' },
      { name: 'Basic', amountCents: 10.5, interval: 'monthly' },
      { name: 'Basic', amountCents: 3_000_000_000, interval: 'monthly' },
      { name: 'Basic', amountCents: 1000, interval: 'weekly' },
      {},
    ])('rejects invalid body %j with 400', async (body) => {
      const response = await createPlan(body).expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        message: 'Validation failed',
      });
    });
  });

  describe('GET /plans', () => {
    it('lists plans paginated', async () => {
      for (const name of ['A', 'B', 'C']) {
        await createPlan({ name, amountCents: 100, interval: 'yearly' });
      }

      const response = await request(app.getHttpServer())
        .get('/plans?page=2&limit=2')
        .expect(200);

      expect(
        response.body.data.map((plan: { name: string }) => plan.name),
      ).toEqual(['C']);
      expect(response.body.meta).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('returns an empty page beyond the last page keeping the meta', async () => {
      await createPlan({ name: 'A', amountCents: 100, interval: 'monthly' });

      const response = await request(app.getHttpServer())
        .get('/plans?page=3&limit=2')
        .expect(200);

      expect(response.body.data).toEqual([]);
      expect(response.body.meta).toEqual({
        page: 3,
        limit: 2,
        total: 1,
        totalPages: 1,
      });
    });

    it.each(['limit=101', 'page=0'])('rejects %s with 400', async (query) => {
      await request(app.getHttpServer()).get(`/plans?${query}`).expect(400);
    });

    it('filters by active', async () => {
      const kept = await createPlan({
        name: 'Kept',
        amountCents: 100,
        interval: 'monthly',
      });
      const retired = await createPlan({
        name: 'Retired',
        amountCents: 100,
        interval: 'monthly',
      });
      await prisma.plan.update({
        where: { id: retired.body.id },
        data: { active: false },
      });

      const active = await request(app.getHttpServer())
        .get('/plans?active=true')
        .expect(200);
      const inactive = await request(app.getHttpServer())
        .get('/plans?active=false')
        .expect(200);

      expect(active.body.data.map((plan: { id: string }) => plan.id)).toEqual([
        kept.body.id,
      ]);
      expect(inactive.body.data.map((plan: { id: string }) => plan.id)).toEqual(
        [retired.body.id],
      );
    });

    it('rejects an invalid active value with 400', async () => {
      await request(app.getHttpServer()).get('/plans?active=maybe').expect(400);
    });
  });
});
