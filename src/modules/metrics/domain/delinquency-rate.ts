export interface DelinquencyInput {
  active: number;
  pastDue: number;
  canceledForPaymentFailure: number;
}

export function delinquencyRate({
  active,
  pastDue,
  canceledForPaymentFailure,
}: DelinquencyInput): number | null {
  const delinquent = pastDue + canceledForPaymentFailure;
  const base = active + delinquent;
  return base === 0 ? null : delinquent / base;
}
