import {
  sign,
  SIGNATURE_HEADER,
  type GatewayChargeJson,
  type GatewayWebhookPayload,
} from '../../src/gateway/index.js';

export const WEBHOOK_PATH = '/webhooks/gateway';

export const currentTimestamp = (offsetSeconds = 0): number =>
  Math.floor(Date.now() / 1000) + offsetSeconds;

export function chargeEvent(
  type: GatewayWebhookPayload['type'],
  charge: Partial<GatewayChargeJson> &
    Pick<GatewayChargeJson, 'id' | 'externalRef'>,
  eventId = `evt_${Math.random().toString(36).slice(2)}`,
): GatewayWebhookPayload {
  const status = type.replace('charge.', '') as GatewayChargeJson['status'];
  return {
    id: eventId,
    type,
    createdAt: new Date().toISOString(),
    data: {
      charge: {
        customerId: 'gcus_1',
        amountCents: 1990,
        method: 'pix',
        status,
        createdAt: new Date().toISOString(),
        ...charge,
      },
    },
  };
}

export function signedHeaders(
  rawBody: string,
  secret: string,
  timestamp = currentTimestamp(),
): Record<string, string> {
  return {
    'content-type': 'application/json',
    [SIGNATURE_HEADER]: sign(rawBody, secret, timestamp),
  };
}
