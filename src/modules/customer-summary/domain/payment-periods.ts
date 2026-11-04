export interface PeriodRow {
  subscriptionId: string;
  periodStart: Date;
}

export function groupByPeriod<T extends PeriodRow>(rows: readonly T[]): T[][] {
  const periods = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${row.subscriptionId}|${row.periodStart.getTime()}`;
    periods.set(key, [...(periods.get(key) ?? []), row]);
  }
  return [...periods.values()];
}
