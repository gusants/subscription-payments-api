import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';

describe('HTTP setup (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
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
});
