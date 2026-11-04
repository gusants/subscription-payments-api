import type { AnonymizedContext, TimelineEntry } from './anonymized-context.js';
import type { SummaryOutput } from './summary-output.js';

const NUMBER_TOKEN = /\d+(?:[.,]\d+)*/g;
const THOUSANDS_GROUP_LENGTH = 3;
const CENTS_PER_UNIT = 100;
const PERCENT = 100;
const MONTHS_PER_YEAR = 12;
const MILLISECONDS_PER_DAY = 86_400_000;
const PRECISION = 100;

export function findUnsupportedNumbers(
  output: Pick<SummaryOutput, 'summary' | 'suggestedAction'>,
  context: AnonymizedContext,
): string[] {
  const supported = supportedValues(context);
  return [output.summary, output.suggestedAction]
    .flatMap((text) => text.match(NUMBER_TOKEN) ?? [])
    .filter((token) => !supported.has(keyOf(parseNumber(token))));
}

function parseNumber(token: string): number {
  const lastSeparator = Math.max(
    token.lastIndexOf('.'),
    token.lastIndexOf(','),
  );
  if (lastSeparator === -1) return Number(token);
  const integer = token.slice(0, lastSeparator).replace(/[.,]/g, '');
  const fraction = token.slice(lastSeparator + 1);
  const separatesThousands = fraction.length === THOUSANDS_GROUP_LENGTH;
  return Number(
    separatesThousands ? integer + fraction : `${integer}.${fraction}`,
  );
}

function keyOf(value: number): number {
  return Math.round(value * PRECISION);
}

function supportedValues(context: AnonymizedContext): Set<number> {
  const { metrics } = context;
  const charges = context.paymentTimeline.flatMap((period) => period.charges);
  const values = [
    ...withRoundings(metrics.monthsAsCustomer),
    ...yearsAndMonths(metrics.monthsAsCustomer),
    metrics.failedAttempts,
    ...(metrics.averageDaysLate === null
      ? []
      : withRoundings(metrics.averageDaysLate)),
    ...(metrics.paymentSuccessRate === null
      ? []
      : [
          metrics.paymentSuccessRate,
          ...withRoundings(metrics.paymentSuccessRate * PERCENT),
        ]),
    ...moneyValues(metrics.totalPaidCents),
    ...(context.plan ? moneyValues(context.plan.amountCents) : []),
    ...charges.flatMap((charge) => moneyValues(charge.amountCents)),
    ...countValues(context, charges),
    ...dateValues(context, charges),
    ...charges.flatMap(daysLate),
  ];
  return new Set(values.map(keyOf));
}

function withRoundings(value: number): number[] {
  return [value, Math.floor(value), Math.round(value), Math.ceil(value)];
}

function yearsAndMonths(months: number): number[] {
  return [Math.floor(months / MONTHS_PER_YEAR), months % MONTHS_PER_YEAR];
}

function moneyValues(cents: number): number[] {
  return [cents, ...withRoundings(cents / CENTS_PER_UNIT)];
}

function countValues(
  context: AnonymizedContext,
  charges: readonly TimelineEntry[],
): number[] {
  const periods = context.paymentTimeline;
  const countOf = (matches: (charge: TimelineEntry) => boolean) =>
    charges.filter(matches).length;
  return [
    periods.length,
    charges.length,
    periods.filter(({ charges: rows }) =>
      rows.some(({ status }) => status === 'paid'),
    ).length,
    ...periods.map(({ charges: rows }) => rows.length),
    ...['paid', 'failed', 'expired', 'pending', 'uncollectible'].map((status) =>
      countOf((charge) => charge.status === status),
    ),
    ...['card', 'pix', 'boleto'].map((method) =>
      countOf((charge) => charge.method === method),
    ),
  ];
}

function dateValues(
  context: AnonymizedContext,
  charges: readonly TimelineEntry[],
): number[] {
  const dates = [
    ...context.paymentTimeline.map(({ periodStart }) => periodStart),
    ...charges.flatMap(({ dueDate, paidDate }) =>
      paidDate === null ? [dueDate] : [dueDate, paidDate],
    ),
  ];
  return dates.flatMap((date) => date.split('-').map(Number));
}

function daysLate({ dueDate, paidDate }: TimelineEntry): number[] {
  if (paidDate === null) return [];
  const elapsed = Date.parse(paidDate) - Date.parse(dueDate);
  return [Math.max(0, Math.round(elapsed / MILLISECONDS_PER_DAY))];
}
