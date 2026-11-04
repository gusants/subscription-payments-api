import type { Prisma } from '../../generated/prisma/client.js';
import type { PlanInterval } from '../../generated/prisma/enums.js';
import {
  nextRetryAt,
  type RetryIntervalUnit,
} from '../../modules/charges/domain/retry-schedule.js';
import { computePeriodEnd } from '../../modules/subscriptions/domain/index.js';
import {
  addDays,
  addHours,
  addMilliseconds,
  startOfUtcDay,
  subtractMonths,
} from './demo-dates.js';
import {
  DEMO_CUSTOMERS,
  DEMO_PLANS,
  type DemoCustomerSpec,
  type DemoPlanSpec,
} from './demo-scenarios.js';
import { seedIds } from './demo-seed-ids.js';

export interface DemoSeed {
  plans: Prisma.PlanCreateManyInput[];
  customers: Prisma.CustomerCreateManyInput[];
  subscriptions: Prisma.SubscriptionCreateManyInput[];
  charges: Prisma.ChargeCreateManyInput[];
  attempts: Prisma.PaymentAttemptCreateManyInput[];
}

interface Period {
  index: number;
  start: Date;
  end: Date;
}

type ChargeParts = Pick<DemoSeed, 'charges' | 'attempts'>;

export interface DemoSeedOptions {
  retryUnit: RetryIntervalUnit;
}

interface DunningTimeline {
  firstFailedAt: Date;
  attemptTimes: Date[];
  retryCount: number;
}

const MILLISECONDS_PER_RETRY_UNIT: Record<RetryIntervalUnit, number> = {
  days: 86_400_000,
  minutes: 60_000,
};

const MONTHS_PER_INTERVAL: Record<PlanInterval, number> = {
  monthly: 1,
  yearly: 12,
};

const DUNNING_OFFSET_DAYS = [0, 1, 3, 7] as const;
const FIRST_RETRY_DELAY_DAYS = 1;
const PIX_EXPIRATION_HOURS = 1;
const CUSTOMER_REQUEST_CANCELLATION_DELAY_DAYS = 6;
const DEMO_EMAIL_DOMAIN = 'demo.example';
const DEMO_CARD_TOKEN_PAID = 'tok_success';
const DEMO_CARD_TOKEN_DECLINED = 'tok_insufficient_funds';

const emptyParts = (): ChargeParts => ({ charges: [], attempts: [] });

const mergeParts = (target: ChargeParts, source: ChargeParts): void => {
  target.charges.push(...source.charges);
  target.attempts.push(...source.attempts);
};

function periodsOf(
  spec: DemoCustomerSpec,
  interval: PlanInterval,
  today: Date,
): Period[] {
  const latestStart = addDays(today, -spec.latestPeriodDaysAgo);
  const step = MONTHS_PER_INTERVAL[interval];
  const starts = Array.from({ length: spec.periodsBeforeLatest + 1 }, (_, i) =>
    subtractMonths(latestStart, (spec.periodsBeforeLatest - i) * step),
  );
  return starts.map((start, index) => ({
    index,
    start,
    end: starts[index + 1] ?? computePeriodEnd(start, interval),
  }));
}

function chargeBase(
  spec: DemoCustomerSpec,
  plan: DemoPlanSpec,
  { index, start, end }: Period,
  issue: number,
): Prisma.ChargeCreateManyInput {
  return {
    id: seedIds.charge(spec.slug, index, issue),
    subscriptionId: seedIds.subscription(spec.slug),
    amountCents: plan.amountCents,
    method: spec.method,
    status: 'paid',
    gatewayChargeId: seedIds.gatewayCharge(spec.slug, index, issue),
    dueDate: start,
    periodStart: start,
    periodEnd: end,
    correlationId: seedIds.correlation(spec.slug, index),
    createdAt: start,
    updatedAt: start,
  };
}

function pixInstructions(
  spec: DemoCustomerSpec,
  period: Period,
  issue: number,
): Pick<Prisma.ChargeCreateManyInput, 'paymentInstructions' | 'expiresAt'> {
  return spec.method === 'pix'
    ? {
        paymentInstructions: {
          type: 'pix',
          copyPaste: `00020126demo${seedIds.gatewayCharge(spec.slug, period.index, issue)}`,
        },
        expiresAt: addHours(period.start, PIX_EXPIRATION_HOURS),
      }
    : {};
}

function attempt(
  spec: DemoCustomerSpec,
  period: Period,
  issue: number,
  number: number,
  at: Date,
  result: 'succeeded' | 'declined',
): Prisma.PaymentAttemptCreateManyInput {
  return {
    id: seedIds.attempt(spec.slug, period.index, issue, number),
    chargeId: seedIds.charge(spec.slug, period.index, issue),
    gatewayChargeId: seedIds.attemptGatewayCharge(
      spec.slug,
      period.index,
      issue,
      number,
    ),
    result,
    failureReason: result === 'declined' ? 'insufficient_funds' : null,
    createdAt: at,
  };
}

const cardAttempts = (
  spec: DemoCustomerSpec,
  period: Period,
  issue: number,
  results: readonly ('succeeded' | 'declined')[],
  times: readonly Date[],
): Prisma.PaymentAttemptCreateManyInput[] =>
  spec.method === 'card'
    ? results.map((result, i) =>
        attempt(spec, period, issue, i + 1, times[i] ?? period.start, result),
      )
    : [];

function paidOnTime(
  spec: DemoCustomerSpec,
  plan: DemoPlanSpec,
  period: Period,
): ChargeParts {
  const issue = 0;
  return {
    charges: [
      {
        ...chargeBase(spec, plan, period, issue),
        ...pixInstructions(spec, period, issue),
        paidAt: period.start,
        attemptCount: spec.method === 'card' ? 1 : 0,
      },
    ],
    attempts: cardAttempts(spec, period, issue, ['succeeded'], [period.start]),
  };
}

function paidAfterRetry(
  spec: DemoCustomerSpec,
  plan: DemoPlanSpec,
  period: Period,
): ChargeParts {
  const issue = 0;
  return {
    charges: [
      {
        ...chargeBase(spec, plan, period, issue),
        paidAt: addDays(period.start, FIRST_RETRY_DELAY_DAYS),
        retryCount: 1,
        firstFailedAt: period.start,
        attemptCount: 2,
      },
    ],
    attempts: cardAttempts(
      spec,
      period,
      issue,
      ['declined', 'succeeded'],
      [period.start, addDays(period.start, FIRST_RETRY_DELAY_DAYS)],
    ),
  };
}

function paidAfterPixReissue(
  spec: DemoCustomerSpec,
  plan: DemoPlanSpec,
  period: Period,
): ChargeParts {
  const expiredIssue = 0;
  const reissuedIssue = 1;
  return {
    charges: [
      {
        ...chargeBase(spec, plan, period, expiredIssue),
        ...pixInstructions(spec, period, expiredIssue),
        status: 'expired',
        firstFailedAt: period.start,
      },
      {
        ...chargeBase(spec, plan, period, reissuedIssue),
        ...pixInstructions(spec, period, reissuedIssue),
        paidAt: addDays(period.start, FIRST_RETRY_DELAY_DAYS),
        retryCount: 1,
        firstFailedAt: period.start,
      },
    ],
    attempts: [],
  };
}

function dunningFailure(
  spec: DemoCustomerSpec,
  plan: DemoPlanSpec,
  period: Period,
  status: 'failed' | 'uncollectible',
  { firstFailedAt, attemptTimes, retryCount }: DunningTimeline,
): ChargeParts {
  const issue = 0;
  const results = attemptTimes.map(() => 'declined' as const);
  return {
    charges: [
      {
        ...chargeBase(spec, plan, period, issue),
        status,
        retryCount,
        firstFailedAt,
        attemptCount: results.length,
      },
    ],
    attempts: cardAttempts(spec, period, issue, results, attemptTimes),
  };
}

function retriesMadeBy(
  firstFailedAt: Date,
  now: Date,
  unit: RetryIntervalUnit,
): number {
  let retriesMade = 0;
  for (
    let due = nextRetryAt(firstFailedAt, retriesMade, unit);
    due !== null && due.getTime() <= now.getTime();
    due = nextRetryAt(firstFailedAt, retriesMade, unit)
  ) {
    retriesMade += 1;
  }
  return retriesMade;
}

function ongoingDunning(
  spec: DemoCustomerSpec,
  now: Date,
  unit: RetryIntervalUnit,
): DunningTimeline {
  const ageInUnits = spec.failureAgeInRetryUnits ?? 0;
  const firstFailedAt = addMilliseconds(
    now,
    -ageInUnits * MILLISECONDS_PER_RETRY_UNIT[unit],
  );
  const retryCount = retriesMadeBy(firstFailedAt, now, unit);
  const retryTimes = Array.from({ length: retryCount }, (_, i) =>
    nextRetryAt(firstFailedAt, i, unit),
  ).filter((time): time is Date => time !== null);
  return {
    firstFailedAt,
    attemptTimes: [firstFailedAt, ...retryTimes],
    retryCount,
  };
}

function exhaustedDunning(period: Period): DunningTimeline {
  return {
    firstFailedAt: period.start,
    attemptTimes: DUNNING_OFFSET_DAYS.map((days) =>
      addDays(period.start, days),
    ),
    retryCount: DUNNING_OFFSET_DAYS.length - 1,
  };
}

function settledPeriod(
  spec: DemoCustomerSpec,
  plan: DemoPlanSpec,
  period: Period,
): ChargeParts {
  if (spec.lateRecoveredPeriods?.includes(period.index)) {
    return paidAfterRetry(spec, plan, period);
  }
  if (spec.reissuedPeriods?.includes(period.index)) {
    return paidAfterPixReissue(spec, plan, period);
  }
  return paidOnTime(spec, plan, period);
}

function latestPeriod(
  spec: DemoCustomerSpec,
  plan: DemoPlanSpec,
  period: Period,
  now: Date,
  unit: RetryIntervalUnit,
): ChargeParts {
  if (spec.ending === 'pastDue') {
    return dunningFailure(
      spec,
      plan,
      period,
      'failed',
      ongoingDunning(spec, now, unit),
    );
  }
  if (spec.ending === 'canceledPaymentFailed') {
    return dunningFailure(
      spec,
      plan,
      period,
      'uncollectible',
      exhaustedDunning(period),
    );
  }
  return settledPeriod(spec, plan, period);
}

function chargesOf(
  spec: DemoCustomerSpec,
  plan: DemoPlanSpec,
  periods: Period[],
  now: Date,
  unit: RetryIntervalUnit,
): ChargeParts {
  const parts = emptyParts();
  periods.forEach((period, position) => {
    const isLatest = position === periods.length - 1;
    mergeParts(
      parts,
      isLatest
        ? latestPeriod(spec, plan, period, now, unit)
        : settledPeriod(spec, plan, period),
    );
  });
  return parts;
}

function cancellationOf(
  spec: DemoCustomerSpec,
  latest: Period,
): Pick<Prisma.SubscriptionCreateManyInput, 'canceledAt' | 'cancelReason'> {
  if (spec.ending === 'canceledPaymentFailed') {
    const lastDunningOffset =
      DUNNING_OFFSET_DAYS[DUNNING_OFFSET_DAYS.length - 1];
    return {
      canceledAt: addDays(latest.start, lastDunningOffset ?? 0),
      cancelReason: 'payment_failed',
    };
  }
  if (spec.ending === 'canceledCustomerRequest') {
    return {
      canceledAt: addDays(
        latest.start,
        CUSTOMER_REQUEST_CANCELLATION_DELAY_DAYS,
      ),
      cancelReason: 'customer_request',
    };
  }
  return {};
}

const statusOf = ({
  ending,
}: DemoCustomerSpec): Prisma.SubscriptionCreateManyInput['status'] => {
  if (ending === 'active') return 'active';
  if (ending === 'pastDue') return 'past_due';
  return 'canceled';
};

function cardTokenOf(spec: DemoCustomerSpec): string | null {
  if (spec.method !== 'card') return null;
  return spec.ending === 'active' || spec.ending === 'canceledCustomerRequest'
    ? DEMO_CARD_TOKEN_PAID
    : DEMO_CARD_TOKEN_DECLINED;
}

function subscriptionOf(
  spec: DemoCustomerSpec,
  periods: Period[],
): Prisma.SubscriptionCreateManyInput {
  const first = periods[0] as Period;
  const latest = periods[periods.length - 1] as Period;
  return {
    id: seedIds.subscription(spec.slug),
    customerId: seedIds.customer(spec.slug),
    planId: seedIds.plan(spec.planSlug),
    paymentMethod: spec.method,
    status: statusOf(spec),
    billingAnchor: first.start,
    currentPeriodStart: latest.start,
    currentPeriodEnd: latest.end,
    cardToken: cardTokenOf(spec),
    createdAt: first.start,
    updatedAt: latest.start,
    ...cancellationOf(spec, latest),
  };
}

export function buildDemoSeed(
  now: Date,
  { retryUnit }: DemoSeedOptions = { retryUnit: 'days' },
): DemoSeed {
  const today = startOfUtcDay(now);
  const seed: DemoSeed = {
    plans: DEMO_PLANS.map((plan) => ({
      id: seedIds.plan(plan.slug),
      name: plan.name,
      amountCents: plan.amountCents,
      interval: plan.interval,
    })),
    customers: [],
    subscriptions: [],
    charges: [],
    attempts: [],
  };
  for (const spec of DEMO_CUSTOMERS) {
    const plan = DEMO_PLANS.find(({ slug }) => slug === spec.planSlug);
    if (!plan) throw new Error(`Unknown demo plan ${spec.planSlug}`);
    const periods = periodsOf(spec, plan.interval, today);
    seed.customers.push({
      id: seedIds.customer(spec.slug),
      name: spec.name,
      email: `${spec.slug}@${DEMO_EMAIL_DOMAIN}`,
      gatewayCustomerId: seedIds.gatewayCustomer(spec.slug),
      createdAt: (periods[0] as Period).start,
    });
    seed.subscriptions.push(subscriptionOf(spec, periods));
    mergeParts(seed, chargesOf(spec, plan, periods, now, retryUnit));
  }
  return seed;
}
