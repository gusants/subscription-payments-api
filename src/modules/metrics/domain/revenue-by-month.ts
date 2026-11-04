import type { MonthlyRevenue } from './metrics-overview.js';
import type { Period } from './period.js';

const MONTH_LABEL_LENGTH = 7;

function monthLabel(date: Date): string {
  return date.toISOString().slice(0, MONTH_LABEL_LENGTH);
}

function monthLabelsOf({ from, to }: Period): string[] {
  const labels: string[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1),
  );
  while (cursor.getTime() <= to.getTime()) {
    labels.push(monthLabel(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return labels;
}

export function revenueByMonth(
  period: Period,
  paid: readonly MonthlyRevenue[],
): MonthlyRevenue[] {
  return monthLabelsOf(period).map((month) => ({
    month,
    revenueCents: paid
      .filter((row) => row.month === month)
      .reduce((total, row) => total + row.revenueCents, 0),
  }));
}
