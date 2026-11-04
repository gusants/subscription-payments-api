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

  scheduled(): ChargeRetryRequest[] {
    return [...this.scheduledByJobId.values()];
  }
}
