import {
  BillingQueue,
  RETRY_SCHEDULING,
  type ChargeRetryRequest,
  type RetryScheduling,
} from '../billing-queue.port.js';

export class RecordingBillingQueue extends BillingQueue {
  private readonly scheduledByJobId = new Map<string, ChargeRetryRequest>();
  failure: Error | null = null;

  scheduleRetry(request: ChargeRetryRequest): Promise<RetryScheduling> {
    if (this.failure) return Promise.reject(this.failure);
    const jobId = `${request.chargeId}:${request.attempt}`;
    const existing = this.scheduledByJobId.get(jobId);
    if (!existing) {
      this.scheduledByJobId.set(jobId, request);
      return Promise.resolve(RETRY_SCHEDULING.enqueued);
    }
    if (request.delayMs === 0 && existing.delayMs > 0) {
      existing.delayMs = 0;
      return Promise.resolve(RETRY_SCHEDULING.promoted);
    }
    return Promise.resolve(RETRY_SCHEDULING.alreadyScheduled);
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
