import type { Customer, CustomerDetail } from './customer.js';
import type { CustomerDetailResponse } from './dto/customer-detail-response.dto.js';
import type { CustomerResponse } from './dto/customer-response.dto.js';

export function toCustomerResponse(customer: Customer): CustomerResponse {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

export function toCustomerDetailResponse(
  customer: CustomerDetail,
): CustomerDetailResponse {
  return {
    ...toCustomerResponse(customer),
    subscriptions: customer.subscriptions.map((subscription) => ({
      ...subscription,
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    })),
  };
}
