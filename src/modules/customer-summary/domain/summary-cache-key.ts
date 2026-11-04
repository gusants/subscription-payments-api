const CACHE_KEY_PREFIX = 'customer-summary';
const NO_ACTIVITY = 'none';
const NO_PLAN_UPDATE = 0;

export interface PaymentActivity {
  lastActivityAt: Date | null;
  chargeCount: number;
  attemptCount: number;
  planUpdatedAt: Date | null;
}

export interface SummaryCacheScope {
  promptVersion: string;
  model: string;
}

export function lastEventId(
  activity: PaymentActivity,
  monthsAsCustomer: number,
): string {
  return [
    activity.lastActivityAt?.getTime() ?? NO_ACTIVITY,
    activity.chargeCount,
    activity.attemptCount,
    activity.planUpdatedAt?.getTime() ?? NO_PLAN_UPDATE,
    monthsAsCustomer,
  ].join('-');
}

export function summaryCacheKey(
  customerId: string,
  eventId: string,
  { promptVersion, model }: SummaryCacheScope,
): string {
  return `${CACHE_KEY_PREFIX}:${customerId}:${promptVersion}:${model}:${eventId}`;
}
