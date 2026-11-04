import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { SIGNATURE_HEADER } from '../../src/gateway/index.js';
import { setupSwagger } from '../../src/shared/http/setup-swagger.js';
import { createTestApp } from '../support/create-test-app.js';
import {
  chargeEvent,
  currentTimestamp,
  signedHeaders,
  WEBHOOK_PATH,
} from '../support/gateway-webhook-fixtures.js';

describe('POST /webhooks/gateway signature (e2e)', () => {
  const secret = process.env['GATEWAY_WEBHOOK_SECRET']!;
  const rawBody = JSON.stringify(
    chargeEvent('charge.paid', {
      id: 'gch_unknown',
      externalRef: 'ch_unknown',
    }),
  );
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

  const post = (body: string, headers: Record<string, string>) =>
    request(app.getHttpServer()).post(WEBHOOK_PATH).set(headers).send(body);

  it('answers 200 received for a correctly signed event', async () => {
    const response = await post(rawBody, signedHeaders(rawBody, secret)).expect(
      200,
    );

    expect(response.body).toEqual({ received: true });
  });

  it('answers 401 in the standard error body when the header is missing', async () => {
    const response = await post(rawBody, {
      'content-type': 'application/json',
    }).expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid webhook signature',
    });
  });

  it('answers 401 for a malformed header', async () => {
    await post(rawBody, {
      'content-type': 'application/json',
      [SIGNATURE_HEADER]: 'not-a-signature',
    }).expect(401);
  });

  it('answers 401 when the body was tampered with after signing', async () => {
    const headers = signedHeaders(rawBody, secret);

    await post(rawBody.replace('gch_unknown', 'gch_other'), headers).expect(
      401,
    );
  });

  it('answers 401 when the body is the same JSON re-serialized with different whitespace', async () => {
    const headers = signedHeaders(rawBody, secret);

    await post(JSON.stringify(JSON.parse(rawBody), null, 2), headers).expect(
      401,
    );
  });

  it('answers 401 for a signature made with another secret', async () => {
    await post(
      rawBody,
      signedHeaders(rawBody, 'another-secret-with-more-than-32-chars'),
    ).expect(401);
  });

  it('answers 401 for a timestamp 6 minutes old', async () => {
    await post(
      rawBody,
      signedHeaders(rawBody, secret, currentTimestamp(-6 * 60)),
    ).expect(401);
  });

  it('answers 401 for a timestamp 6 minutes in the future', async () => {
    await post(
      rawBody,
      signedHeaders(rawBody, secret, currentTimestamp(6 * 60)),
    ).expect(401);
  });

  it('answers 400 when the signature is valid but the payload is not a gateway event', async () => {
    const invalid = JSON.stringify({ id: 'evt_1', type: 'charge.refunded' });

    const response = await post(invalid, signedHeaders(invalid, secret)).expect(
      400,
    );

    expect(response.body).toMatchObject({
      statusCode: 400,
      message: 'Validation failed',
    });
  });

  it('documents the endpoint under the webhooks tag with the signature header', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);

    const operation = body.paths['/webhooks/gateway'].post;
    expect(operation.tags).toEqual(['webhooks']);
    expect(operation.parameters).toContainEqual(
      expect.objectContaining({ name: SIGNATURE_HEADER, in: 'header' }),
    );
  });
});
