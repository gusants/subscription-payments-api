import { z } from 'zod';
import { gatewayChargeJsonSchema } from './gateway-charge-json.js';
import type { GatewayChargeStatus } from './payment-gateway.port.js';

export const GATEWAY_EVENT_TYPES = [
  'charge.paid',
  'charge.failed',
  'charge.expired',
] as const;

export type GatewayEventType = (typeof GATEWAY_EVENT_TYPES)[number];

export const gatewayWebhookPayloadSchema = z.object({
  id: z.string(),
  type: z.enum(GATEWAY_EVENT_TYPES),
  createdAt: z.iso.datetime(),
  data: z.object({ charge: gatewayChargeJsonSchema }),
});

export type GatewayWebhookPayload = z.infer<typeof gatewayWebhookPayloadSchema>;

const EVENT_TYPE_BY_STATUS: Readonly<
  Record<GatewayChargeStatus, GatewayEventType | null>
> = {
  pending: null,
  paid: 'charge.paid',
  failed: 'charge.failed',
  expired: 'charge.expired',
};

export function eventTypeForStatus(
  status: GatewayChargeStatus,
): GatewayEventType | null {
  return EVENT_TYPE_BY_STATUS[status];
}
