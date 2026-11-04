import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FetchWebhookTransport } from './fetch-webhook-transport.js';

describe('FetchWebhookTransport', () => {
  let server: Server;
  let url: string;
  let received: { body: string; headers: IncomingMessage['headers'] } | null;
  let answerWith: number;

  beforeEach(async () => {
    received = null;
    answerWith = 200;
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received = {
          body: Buffer.concat(chunks).toString('utf8'),
          headers: request.headers,
        };
        response.writeHead(answerWith).end('ignored');
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhooks/gateway`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('posts the raw body with the headers and answers the status code', async () => {
    const status = await new FetchWebhookTransport().post({
      url,
      body: '{"id":"evt_1"}',
      headers: {
        'content-type': 'application/json',
        'x-gateway-signature': 't=1,v1=ab',
      },
    });

    expect(status).toBe(200);
    expect(received?.body).toBe('{"id":"evt_1"}');
    expect(received?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-gateway-signature': 't=1,v1=ab',
    });
  });

  it('answers a non-2xx status instead of throwing', async () => {
    answerWith = 404;

    await expect(
      new FetchWebhookTransport().post({ url, body: '{}', headers: {} }),
    ).resolves.toBe(404);
  });

  it('throws when nothing listens at the url', async () => {
    await new Promise((resolve) => server.close(resolve));
    server = createServer();

    await expect(
      new FetchWebhookTransport().post({ url, body: '{}', headers: {} }),
    ).rejects.toThrow();
  });
});
