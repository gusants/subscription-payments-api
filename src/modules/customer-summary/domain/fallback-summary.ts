import type { PaymentMetrics } from './payment-metrics.js';
import type {
  PaymentBehavior,
  RiskLevel,
  SummaryOutput,
} from './summary-output.js';

const UNRELIABLE_BELOW_SUCCESS_RATE = 0.5;
const FREQUENT_DELAYS_BELOW_SUCCESS_RATE = 0.8;
const FREQUENT_DELAYS_ABOVE_DAYS_LATE = 5;
const OCCASIONAL_DELAYS_ABOVE_DAYS_LATE = 1;
const CENTS_PER_UNIT = 100;
const PERCENT = 100;

const RISK_BY_BEHAVIOR: Record<
  Exclude<PaymentBehavior, 'insufficient_history'>,
  RiskLevel
> = {
  on_time: 'low',
  occasional_delays: 'medium',
  frequent_delays: 'high',
  unreliable: 'high',
};

const ACTION_BY_BEHAVIOR: Record<PaymentBehavior, string> = {
  on_time: 'No action needed.',
  occasional_delays:
    'Remind the customer before the due date and suggest keeping the payment method up to date.',
  frequent_delays:
    'Contact the customer to review the payment method and offer a more reliable one, such as Pix.',
  unreliable:
    'Have a team member contact the customer to resolve the pending payments before the next billing cycle.',
  insufficient_history:
    'Wait for more payment history before taking any action.',
};

export function classifyPaymentBehavior(
  metrics: PaymentMetrics,
): PaymentBehavior {
  const { paymentSuccessRate: successRate, averageDaysLate } = metrics;
  if (successRate === null) return 'insufficient_history';
  const daysLate = averageDaysLate ?? 0;
  if (successRate < UNRELIABLE_BELOW_SUCCESS_RATE) return 'unreliable';
  if (
    successRate < FREQUENT_DELAYS_BELOW_SUCCESS_RATE ||
    daysLate > FREQUENT_DELAYS_ABOVE_DAYS_LATE
  ) {
    return 'frequent_delays';
  }
  const hasSetbacks =
    successRate < 1 ||
    metrics.failedAttempts > 0 ||
    daysLate > OCCASIONAL_DELAYS_ABOVE_DAYS_LATE;
  return hasSetbacks ? 'occasional_delays' : 'on_time';
}

export function assessRisk(
  behavior: PaymentBehavior,
  metrics: PaymentMetrics,
): RiskLevel {
  if (behavior === 'insufficient_history') {
    return metrics.failedAttempts > 0 ? 'medium' : 'low';
  }
  return RISK_BY_BEHAVIOR[behavior];
}

export function buildFallbackSummary(metrics: PaymentMetrics): SummaryOutput {
  const paymentBehavior = classifyPaymentBehavior(metrics);
  return {
    summary: describeMetrics(metrics),
    paymentBehavior,
    riskLevel: assessRisk(paymentBehavior, metrics),
    suggestedAction: ACTION_BY_BEHAVIOR[paymentBehavior],
  };
}

function describeMetrics(metrics: PaymentMetrics): string {
  const tenure = `Customer for ${plural(metrics.monthsAsCustomer, 'month')}, with ${formatAmount(metrics.totalPaidCents)} paid in total.`;
  const failures = `${plural(metrics.failedAttempts, 'declined payment attempt')} on record.`;
  if (metrics.paymentSuccessRate === null) {
    return `${tenure} There is no settled charge yet, so the payment history is too short to assess. ${failures}`;
  }
  const rate = `${Math.round(metrics.paymentSuccessRate * PERCENT)}% of settled charges were paid`;
  const delay =
    metrics.averageDaysLate === null
      ? ''
      : `, on average ${metrics.averageDaysLate} days after the due date`;
  return `${tenure} ${rate}${delay}. ${failures}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function formatAmount(cents: number): string {
  return (cents / CENTS_PER_UNIT).toFixed(2);
}
