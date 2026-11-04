import type { CustomerPaymentRecord } from './customer-payment-record.js';

export abstract class CustomerSummaryRepository {
  abstract findPaymentRecord(
    customerId: string,
  ): Promise<CustomerPaymentRecord | null>;
}
