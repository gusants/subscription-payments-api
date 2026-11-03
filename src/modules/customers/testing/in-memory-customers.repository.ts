import { ConflictError } from '../../../shared/errors/index.js';
import type {
  Customer,
  CustomerDetail,
  CustomerFilter,
  CustomerPage,
  NewCustomer,
  PageWindow,
  SubscriptionSummary,
} from '../customer.js';
import { CustomersRepository } from '../customers.repository.js';

export class InMemoryCustomersRepository extends CustomersRepository {
  private readonly customers: Customer[] = [];
  private readonly subscriptionsByCustomer = new Map<
    string,
    SubscriptionSummary[]
  >();

  create(customer: NewCustomer): Promise<Customer> {
    if (this.customers.some(({ email }) => email === customer.email)) {
      return Promise.reject(
        new ConflictError(
          `Customer with email ${customer.email} already exists`,
        ),
      );
    }
    const now = new Date();
    const created: Customer = { ...customer, createdAt: now, updatedAt: now };
    this.customers.push(created);
    return Promise.resolve(created);
  }

  findById(id: string): Promise<Customer | null> {
    return Promise.resolve(
      this.customers.find((customer) => customer.id === id) ?? null,
    );
  }

  findDetailById(id: string): Promise<CustomerDetail | null> {
    const customer = this.customers.find((candidate) => candidate.id === id);
    if (!customer) return Promise.resolve(null);
    return Promise.resolve({
      ...customer,
      subscriptions: this.subscriptionsByCustomer.get(id) ?? [],
    });
  }

  list(
    { search, subscriptionStatus }: CustomerFilter,
    { skip, take }: PageWindow,
  ): Promise<CustomerPage> {
    const needle = search?.toLowerCase();
    const matching = this.customers
      .filter(
        (customer) =>
          !needle ||
          customer.name.toLowerCase().includes(needle) ||
          customer.email.toLowerCase().includes(needle),
      )
      .filter(
        (customer) =>
          !subscriptionStatus ||
          (this.subscriptionsByCustomer.get(customer.id) ?? []).some(
            ({ status }) => status === subscriptionStatus,
          ),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    return Promise.resolve({
      items: matching.slice(skip, skip + take),
      total: matching.length,
    });
  }

  addSubscription(customerId: string, subscription: SubscriptionSummary): void {
    const existing = this.subscriptionsByCustomer.get(customerId) ?? [];
    this.subscriptionsByCustomer.set(customerId, [...existing, subscription]);
  }
}
