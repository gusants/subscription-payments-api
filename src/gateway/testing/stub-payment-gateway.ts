import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import {
  PaymentGateway,
  type CreateGatewayCharge,
  type CreateGatewayCustomer,
  type GatewayCharge,
  type GatewayCustomer,
} from '../payment-gateway.port.js';

type ChargeResult = Pick<GatewayCharge, 'status' | 'failureReason'>;

export class StubPaymentGateway extends PaymentGateway {
  readonly customersRequested: CreateGatewayCustomer[] = [];
  readonly chargesRequested: CreateGatewayCharge[] = [];
  private chargeResult: ChargeResult = { status: 'paid' };
  private customerError: Error | null = null;
  private chargeError: Error | null = null;

  respondWith(result: ChargeResult): void {
    this.chargeResult = result;
  }

  failCustomerCreationWith(error: Error): void {
    this.customerError = error;
  }

  failChargeCreationWith(error: Error): void {
    this.chargeError = error;
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
    if (this.chargeError) return Promise.reject(this.chargeError);
    return Promise.resolve({
      id: generateId(ID_PREFIXES.gatewayCharge),
      customerId: input.gatewayCustomerId,
      externalRef: input.externalRef,
      amountCents: input.amountCents,
      method: input.method,
      createdAt: new Date(),
      ...this.chargeResult,
    });
  }

  getCharge(gatewayChargeId: string): Promise<GatewayCharge> {
    return Promise.reject(
      new Error(`StubPaymentGateway.getCharge(${gatewayChargeId}) not stubbed`),
    );
  }
}
