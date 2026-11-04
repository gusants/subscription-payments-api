import type {
  ContextCharge,
  ContextPlan,
  HistoryAttempt,
  PaymentActivity,
} from './domain/index.js';

export interface CustomerPaymentRecord {
  customerId: string;
  customerSince: Date;
  plan: ContextPlan | null;
  charges: ContextCharge[];
  attempts: HistoryAttempt[];
  activity: PaymentActivity;
}
