import {
  nextRetryAt,
  retryDelayMs,
  type RetryIntervalUnit,
} from './retry-schedule.js';
import type { Subscription } from '../../subscriptions/subscription.js';
import type { Charge, DunningExhaustion } from '../charge.js';
import type { ChargeStatus } from '../charge-status.js';
import { statusesAllowedToTransitionTo } from './charge-transitions.js';
import { subscriptionChange } from './subscription-change.js';

export type DunningStep =
  | { kind: 'none' }
  | { kind: 'schedule'; attempt: number; delayMs: number }
  | { kind: 'exhaust'; exhaustion: DunningExhaustion };

export interface DunningStepInput {
  charge: Pick<Charge, 'id' | 'status' | 'retryCount' | 'firstFailedAt'>;
  subscription: Pick<Subscription, 'id' | 'status'>;
  unit: RetryIntervalUnit;
  now: Date;
}

const STATUSES_IN_DUNNING: readonly ChargeStatus[] = ['failed', 'expired'];

function exhaustionOf({
  charge,
  subscription,
  now,
}: Pick<
  DunningStepInput,
  'charge' | 'subscription' | 'now'
>): DunningExhaustion {
  return {
    charge:
      charge.status === 'failed'
        ? {
            id: charge.id,
            fromAnyOf: statusesAllowedToTransitionTo('uncollectible'),
          }
        : null,
    subscription: {
      id: subscription.id,
      change: subscriptionChange(
        subscription,
        'canceled',
        now,
        'payment_failed',
      ),
    },
  };
}

export function dunningStepAfterFailure(input: DunningStepInput): DunningStep {
  const { charge, subscription, unit, now } = input;
  if (!STATUSES_IN_DUNNING.includes(charge.status)) return { kind: 'none' };
  if (subscription.status === 'canceled') return { kind: 'none' };
  const retryAt = nextRetryAt(
    charge.firstFailedAt ?? now,
    charge.retryCount,
    unit,
  );
  if (!retryAt) {
    return { kind: 'exhaust', exhaustion: exhaustionOf(input) };
  }
  return {
    kind: 'schedule',
    attempt: charge.retryCount + 1,
    delayMs: retryDelayMs(now, retryAt),
  };
}

export type DunningRetryKind = 'resubmit' | 'reissue' | 'resume';

export function dunningRetryKind(
  { status, retryCount }: Pick<Charge, 'status' | 'retryCount'>,
  attempt: number,
): DunningRetryKind | null {
  if (status === 'pending') return retryCount === attempt ? 'resume' : null;
  if (retryCount !== attempt - 1) return null;
  if (status === 'failed') return 'resubmit';
  if (status === 'expired') return 'reissue';
  return null;
}
