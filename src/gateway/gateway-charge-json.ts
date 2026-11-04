import { z } from 'zod';
import type { GatewayCharge } from './payment-gateway.port.js';
import { paymentInstructionsSchema } from './payment-instructions.js';

export const GATEWAY_CHARGE_METHODS = ['card', 'pix', 'boleto'] as const;

export const GATEWAY_CHARGE_STATUSES = [
  'pending',
  'paid',
  'failed',
  'expired',
] as const;

export const GATEWAY_FAILURE_REASONS = [
  'insufficient_funds',
  'expired_card',
  'invalid_token',
] as const;

export const gatewayChargeJsonSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  externalRef: z.string(),
  amountCents: z.number().int(),
  method: z.enum(GATEWAY_CHARGE_METHODS),
  status: z.enum(GATEWAY_CHARGE_STATUSES),
  failureReason: z.enum(GATEWAY_FAILURE_REASONS).optional(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().optional(),
  paidAt: z.iso.datetime().optional(),
  paymentInstructions: paymentInstructionsSchema.optional(),
});

export type GatewayChargeJson = z.infer<typeof gatewayChargeJsonSchema>;

export function toGatewayChargeJson(charge: GatewayCharge): GatewayChargeJson {
  const { createdAt, expiresAt, paidAt, ...rest } = charge;
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    ...(expiresAt && { expiresAt: expiresAt.toISOString() }),
    ...(paidAt && { paidAt: paidAt.toISOString() }),
  };
}
