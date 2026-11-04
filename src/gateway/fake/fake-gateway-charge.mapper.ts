import type { GatewayCharge } from '../payment-gateway.port.js';
import type { StoredGatewayCharge } from './fake-gateway.store.js';

export function toGatewayCharge(stored: StoredGatewayCharge): GatewayCharge {
  return {
    id: stored.id,
    customerId: stored.customerId,
    externalRef: stored.externalRef,
    amountCents: stored.amountCents,
    method: stored.method,
    status: stored.status,
    ...(stored.failureReason && { failureReason: stored.failureReason }),
    createdAt: new Date(stored.createdAt),
    ...(stored.expiresAt && { expiresAt: new Date(stored.expiresAt) }),
    ...(stored.paidAt && { paidAt: new Date(stored.paidAt) }),
    ...(stored.paymentInstructions && {
      paymentInstructions: stored.paymentInstructions,
    }),
  };
}
