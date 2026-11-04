import type { CustomerPaymentRecord } from '../customer-payment-record.js';
import { CustomerSummaryRepository } from '../customer-summary.repository.js';

export class InMemoryCustomerSummaryRepository extends CustomerSummaryRepository {
  private readonly records = new Map<string, CustomerPaymentRecord>();

  put(record: CustomerPaymentRecord): void {
    this.records.set(record.customerId, record);
  }

  findPaymentRecord(customerId: string): Promise<CustomerPaymentRecord | null> {
    return Promise.resolve(this.records.get(customerId) ?? null);
  }
}
