const MILLISECONDS_PER_DAY = 86_400_000;
const MILLISECONDS_PER_HOUR = 3_600_000;

export const startOfUtcDay = (date: Date): Date =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * MILLISECONDS_PER_DAY);

export const addMilliseconds = (date: Date, milliseconds: number): Date =>
  new Date(date.getTime() + milliseconds);

export const addHours = (date: Date, hours: number): Date =>
  new Date(date.getTime() + hours * MILLISECONDS_PER_HOUR);

export function subtractMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() - months;
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month + 1, 0));
  const day = Math.min(date.getUTCDate(), lastDayOfTargetMonth.getUTCDate());
  return new Date(Date.UTC(year, month, day));
}
