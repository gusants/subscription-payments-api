import {
  WebhookTransport,
  type WebhookRequest,
} from '../fake/webhook/webhook-transport.js';

export class RecordingWebhookTransport extends WebhookTransport {
  readonly requests: WebhookRequest[] = [];
  private readonly responses: (number | Error)[] = [];

  respondWith(...responses: (number | Error)[]): void {
    this.responses.push(...responses);
  }

  post(request: WebhookRequest): Promise<number> {
    this.requests.push(request);
    const response = this.responses.shift() ?? 200;
    return response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response);
  }
}
