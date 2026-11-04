export interface WebhookRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

export abstract class WebhookTransport {
  abstract post(request: WebhookRequest): Promise<number>;
}
