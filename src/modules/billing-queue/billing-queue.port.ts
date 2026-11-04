export interface ChargeRetryRequest {
  chargeId: string;
  attempt: number;
  delayMs: number;
  correlationId: string;
}

export abstract class BillingQueue {
  abstract scheduleRetry(request: ChargeRetryRequest): Promise<void>;
  abstract promoteDelayedRetries(): Promise<number>;
}
