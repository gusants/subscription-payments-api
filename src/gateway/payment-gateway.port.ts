import type { PaymentInstructions } from './payment-instructions.js';

export type GatewayChargeMethod = 'card' | 'pix' | 'boleto';

export type GatewayChargeStatus = 'pending' | 'paid' | 'failed' | 'expired';

export type GatewayFailureReason =
  'insufficient_funds' | 'expired_card' | 'invalid_token';

export interface CreateGatewayCustomer {
  externalRef: string;
  name: string;
  email: string;
}

export interface GatewayCustomer {
  id: string;
  externalRef: string;
}

interface CreateGatewayChargeBase {
  gatewayCustomerId: string;
  amountCents: number;
  externalRef: string;
  idempotencyKey: string;
}

export type CreateGatewayCharge =
  | (CreateGatewayChargeBase & { method: 'card'; cardToken: string })
  | (CreateGatewayChargeBase & { method: 'pix' | 'boleto' });

export interface GatewayCharge {
  id: string;
  customerId: string;
  externalRef: string;
  amountCents: number;
  method: GatewayChargeMethod;
  status: GatewayChargeStatus;
  failureReason?: GatewayFailureReason;
  createdAt: Date;
  expiresAt?: Date;
  paidAt?: Date;
  paymentInstructions?: PaymentInstructions;
}

export abstract class PaymentGateway {
  abstract createCustomer(
    input: CreateGatewayCustomer,
  ): Promise<GatewayCustomer>;
  abstract createCharge(input: CreateGatewayCharge): Promise<GatewayCharge>;
  abstract findChargeByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<GatewayCharge | null>;
  abstract getCharge(gatewayChargeId: string): Promise<GatewayCharge>;
}
