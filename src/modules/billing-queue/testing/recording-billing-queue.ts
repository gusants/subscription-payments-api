import {
  BillingQueue,
  type ChargeRetryRequest,
} from '../billing-queue.port.js';

export class RecordingBillingQueue extends BillingQueue {
  private readonly scheduledByJobId = new Map<string, ChargeRetryRequest>();
  failure: Error | null = null;

  scheduleRetry(request: ChargeRetryRequest): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    const jobId = `${request.chargeId}:${request.attempt}`;
    if (!this.scheduledByJobId.has(jobId)) {
      this.scheduledByJobId.set(jobId, request);
    }
    return Promise.resolve();
  }

  promoteDelayedRetries(): Promise<number> {
    const delayed = this.scheduled().filter(({ delayMs }) => delayMs > 0);
    for (const request of delayed) request.delayMs = 0;
    return Promise.resolve(delayed.length);
  }

  scheduled(): ChargeRetryRequest[] {
    return [...this.scheduledByJobId.values()];
  }
}
