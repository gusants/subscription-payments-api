import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';
import { createTestApp } from '../support/create-test-app.js';

describe('HTTP setup (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = createTestApp(moduleRef);
    setupSwagger(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the OpenAPI document', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(response.body.paths).toHaveProperty('/health');
  });

  it.each([
    ['/plans', ['get', 'post']],
    ['/customers', ['get', 'post']],
    ['/customers/{id}', ['get']],
    ['/subscriptions', ['post']],
    ['/subscriptions/{id}', ['get']],
    ['/subscriptions/{id}/cancel', ['post']],
  ])('documents %s with its methods', async (path, methods) => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    expect(Object.keys(response.body.paths[path]).sort()).toEqual(methods);
  });

  it('serves the Swagger UI', async () => {
    await request(app.getHttpServer()).get('/docs').expect(200);
  });

  it('answers unknown routes with the standard error body', async () => {
    const response = await request(app.getHttpServer())
      .get('/nope')
      .expect(404);

    expect(response.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'Cannot GET /nope',
    });
  });

  it('answers a malformed JSON body with the standard 400 error body', async () => {
    const response = await request(app.getHttpServer())
      .post('/plans')
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: expect.any(String),
    });
  });

  it('rejects a page beyond the supported range with 400', async () => {
    const response = await request(app.getHttpServer())
      .get('/plans')
      .query({ page: 1_000_000_000_000 })
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      message: 'Validation failed',
    });
  });

  it('echoes a valid x-correlation-id and generates one otherwise', async () => {
    const echoed = await request(app.getHttpServer())
      .get('/plans')
      .set('x-correlation-id', 'client-journey-0001')
      .expect(200);
    const replaced = await request(app.getHttpServer())
      .get('/plans')
      .set('x-correlation-id', 'no')
      .expect(200);

    expect(echoed.headers['x-correlation-id']).toBe('client-journey-0001');
    expect(replaced.headers['x-correlation-id']).toMatch(/^cor_[0-9a-z]{26}$/);
  });
});
