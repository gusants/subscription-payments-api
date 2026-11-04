export interface ChargeRetryRequest {
  chargeId: string;
  attempt: number;
  delayMs: number;
}

export abstract class BillingQueue {
  abstract scheduleRetry(request: ChargeRetryRequest): Promise<void>;
}
