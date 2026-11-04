const CACHE_KEY_PREFIX = 'customer-summary';
const NO_ACTIVITY = 'none';

export interface PaymentActivity {
  lastActivityAt: Date | null;
  chargeCount: number;
  attemptCount: number;
}

export function lastEventId(activity: PaymentActivity): string {
  if (activity.lastActivityAt === null) return NO_ACTIVITY;
  return [
    activity.lastActivityAt.getTime(),
    activity.chargeCount,
    activity.attemptCount,
  ].join('-');
}

export function summaryCacheKey(customerId: string, eventId: string): string {
  return `${CACHE_KEY_PREFIX}:${customerId}:${eventId}`;
}
