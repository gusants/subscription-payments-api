import type {
  ChargeStatus,
  PaymentAttemptResult,
} from '../../charges/charge-status.js';

export interface HistoryCharge {
  status: ChargeStatus;
  amountCents: number;
  dueDate: Date;
  paidAt: Date | null;
}

export interface HistoryAttempt {
  result: PaymentAttemptResult;
}

export interface PaymentHistory {
  customerSince: Date;
  charges: readonly HistoryCharge[];
  attempts: readonly HistoryAttempt[];
}
