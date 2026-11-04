import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import { eventTypeForStatus } from '../gateway-webhook-event.js';
import type {
  FakeGatewayData,
  StoredGatewayCharge,
  StoredGatewayEvent,
} from './fake-gateway.store.js';

export function appendChargeEvents(
  data: FakeGatewayData,
  charges: readonly StoredGatewayCharge[],
  occurredAt: Date,
): StoredGatewayEvent[] {
  return charges.flatMap((charge) => {
    const type = eventTypeForStatus(charge.status);
    if (!type) return [];
    const event: StoredGatewayEvent = {
      id: generateId(ID_PREFIXES.gatewayEvent),
      type,
      chargeId: charge.id,
      externalRef: charge.externalRef,
      occurredAt: occurredAt.toISOString(),
      deliveredAt: null,
      attempts: 0,
    };
    data.events.push(event);
    return [event];
  });
}
