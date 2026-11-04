import { readFile } from 'node:fs/promises';
import {
  sign,
  toGatewayChargeJson,
  SIGNATURE_HEADER,
  type GatewayChargeJson,
  type GatewayWebhookPayload,
} from '../../src/gateway/index.js';
import { toGatewayCharge } from '../../src/gateway/fake/fake-gateway-charge.mapper.js';
import type { StoredGatewayCharge } from '../../src/gateway/fake/fake-gateway.store.js';

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

interface StoredEvent {
  id: string;
  type: GatewayWebhookPayload['type'];
  chargeId: string;
  occurredAt: string;
}

interface GatewayFile {
  charges: StoredGatewayCharge[];
  events: StoredEvent[];
}

export async function storedWebhookPayloads(): Promise<
  GatewayWebhookPayload[]
> {
  const { charges, events }: GatewayFile = JSON.parse(
    await readFile(process.env['FAKE_GATEWAY_DATA_FILE']!, 'utf8'),
  );
  return events.map(({ id, type, chargeId, occurredAt }) => ({
    id,
    type,
    createdAt: occurredAt,
    data: {
      charge: toGatewayChargeJson(
        toGatewayCharge(charges.find((charge) => charge.id === chargeId)!),
      ),
    },
  }));
}
