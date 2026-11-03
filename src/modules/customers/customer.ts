import type { SubscriptionStatus } from '../subscriptions/subscription-status.js';

export interface Customer {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionSummary {
  id: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
}

export interface CustomerDetail extends Customer {
  subscriptions: SubscriptionSummary[];
}

export type NewCustomer = Pick<Customer, 'id' | 'name' | 'email'>;

export interface CustomerFilter {
  search?: string;
  subscriptionStatus?: SubscriptionStatus;
}

export interface PageWindow {
  skip: number;
  take: number;
}

export interface CustomerPage {
  items: Customer[];
  total: number;
}
