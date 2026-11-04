export type GatewayChargeMethod = 'card';

export type GatewayChargeStatus = 'pending' | 'paid' | 'failed';

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

export interface CreateGatewayCharge {
  gatewayCustomerId: string;
  amountCents: number;
  method: GatewayChargeMethod;
  cardToken: string;
  externalRef: string;
  idempotencyKey: string;
}

export interface GatewayCharge {
  id: string;
  customerId: string;
  externalRef: string;
  amountCents: number;
  method: GatewayChargeMethod;
  status: GatewayChargeStatus;
  failureReason?: GatewayFailureReason;
  createdAt: Date;
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
