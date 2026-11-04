import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import {
  PaymentGateway,
  type CreateGatewayCharge,
  type CreateGatewayCustomer,
  type GatewayCharge,
  type GatewayCustomer,
} from '../payment-gateway.port.js';

type ChargeResult = Pick<
  GatewayCharge,
  'status' | 'failureReason' | 'expiresAt' | 'paidAt' | 'paymentInstructions'
>;

export const STUB_EXPIRES_AT = new Date('2099-01-01T00:00:00.000Z');

function defaultResultFor({ method }: CreateGatewayCharge): ChargeResult {
  switch (method) {
    case 'card':
      return { status: 'paid' };
    case 'pix':
      return {
        status: 'pending',
        expiresAt: STUB_EXPIRES_AT,
        paymentInstructions: { type: 'pix', copyPaste: 'stub-pix-copy-paste' },
      };
    case 'boleto':
      return {
        status: 'pending',
        expiresAt: STUB_EXPIRES_AT,
        paymentInstructions: {
          type: 'boleto',
          digitableLine: 'stub-digitable-line',
          barcode: 'stub-barcode',
        },
      };
  }
}

interface ChargeFailure {
  error: Error;
  remaining: number;
  afterProcessing: boolean;
}

interface ChargeFailureOptions {
  times?: number;
  afterProcessing?: boolean;
}

export class StubPaymentGateway extends PaymentGateway {
  readonly customersRequested: CreateGatewayCustomer[] = [];
  readonly chargesRequested: CreateGatewayCharge[] = [];
  readonly chargesProcessed = new Map<string, GatewayCharge>();
  private chargeResult: ChargeResult | null = null;
  private customerError: Error | null = null;
  private lookupError: Error | null = null;
  private chargeFailure: ChargeFailure | null = null;

  respondWith(result: ChargeResult): void {
    this.chargeResult = result;
  }

  failCustomerCreationWith(error: Error): void {
    this.customerError = error;
  }

  failChargeCreationWith(
    error: Error,
    { times = Infinity, afterProcessing = false }: ChargeFailureOptions = {},
  ): void {
    this.chargeFailure = { error, remaining: times, afterProcessing };
  }

  failLookupWith(error: Error): void {
    this.lookupError = error;
  }

  createCustomer(input: CreateGatewayCustomer): Promise<GatewayCustomer> {
    this.customersRequested.push(input);
    if (this.customerError) return Promise.reject(this.customerError);
    return Promise.resolve({
      id: generateId(ID_PREFIXES.gatewayCustomer),
      externalRef: input.externalRef,
    });
  }

  createCharge(input: CreateGatewayCharge): Promise<GatewayCharge> {
    this.chargesRequested.push(input);
    const failure = this.consumeChargeFailure();
    if (failure && !failure.afterProcessing)
      return Promise.reject(failure.error);
    const charge = this.processCharge(input);
    return failure ? Promise.reject(failure.error) : Promise.resolve(charge);
  }

  findChargeByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<GatewayCharge | null> {
    if (this.lookupError) return Promise.reject(this.lookupError);
    return Promise.resolve(this.chargesProcessed.get(idempotencyKey) ?? null);
  }

  getCharge(gatewayChargeId: string): Promise<GatewayCharge> {
    return Promise.reject(
      new Error(`StubPaymentGateway.getCharge(${gatewayChargeId}) not stubbed`),
    );
  }

  private consumeChargeFailure(): ChargeFailure | null {
    const failure = this.chargeFailure;
    if (!failure || failure.remaining === 0) return null;
    failure.remaining -= 1;
    return failure;
  }

  private processCharge(input: CreateGatewayCharge): GatewayCharge {
    const existing = this.chargesProcessed.get(input.idempotencyKey);
    if (existing) return existing;
    const charge: GatewayCharge = {
      id: generateId(ID_PREFIXES.gatewayCharge),
      customerId: input.gatewayCustomerId,
      externalRef: input.externalRef,
      amountCents: input.amountCents,
      method: input.method,
      createdAt: new Date(),
      ...(this.chargeResult ?? defaultResultFor(input)),
    };
    this.chargesProcessed.set(input.idempotencyKey, charge);
    return charge;
  }
}
