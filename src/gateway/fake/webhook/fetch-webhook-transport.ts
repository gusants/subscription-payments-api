import { Injectable } from '@nestjs/common';
import { WebhookTransport, type WebhookRequest } from './webhook-transport.js';

const REQUEST_TIMEOUT_MS = 5000;

@Injectable()
export class FetchWebhookTransport extends WebhookTransport {
  async post({ url, body, headers }: WebhookRequest): Promise<number> {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return response.status;
  }
}
