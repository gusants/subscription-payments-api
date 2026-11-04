import {
  PaymentGateway,
  type CreateGatewayCharge,
  type CreateGatewayCustomer,
  type GatewayCharge,
  type GatewayCustomer,
} from '../payment-gateway.port.js';
import { GatewayOutcomeUnknownError } from '../gateway-outcome-unknown.error.js';

export class LossyPaymentGateway extends PaymentGateway {
  private responsesToLose = 0;
  private afterCharge: () => Promise<void> = () => Promise.resolve();

  constructor(private readonly inner: PaymentGateway) {
    super();
  }

  loseNextResponse(): void {
    this.responsesToLose += 1;
  }

  runAfterCharge(hook: () => Promise<void>): void {
    this.afterCharge = hook;
  }

  createCustomer(input: CreateGatewayCustomer): Promise<GatewayCustomer> {
    return this.inner.createCustomer(input);
  }

  async createCharge(input: CreateGatewayCharge): Promise<GatewayCharge> {
    const charge = await this.inner.createCharge(input);
    await this.afterCharge();
    if (this.responsesToLose > 0) {
      this.responsesToLose -= 1;
      throw new GatewayOutcomeUnknownError('response lost');
    }
    return charge;
  }

  findChargeByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<GatewayCharge | null> {
    return this.inner.findChargeByIdempotencyKey(idempotencyKey);
  }

  getCharge(gatewayChargeId: string): Promise<GatewayCharge> {
    return this.inner.getCharge(gatewayChargeId);
  }
}
