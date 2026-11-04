import type {
  Customer,
  CustomerDetail,
  CustomerFilter,
  CustomerPage,
  NewCustomer,
  PageWindow,
} from './customer.js';

export abstract class CustomersRepository {
  abstract create(customer: NewCustomer): Promise<Customer>;
  abstract assignGatewayCustomerId(
    id: string,
    gatewayCustomerId: string,
  ): Promise<string>;
  abstract replaceGatewayCustomerId(
    id: string,
    replaced: string,
    replacement: string,
  ): Promise<string>;
  abstract findById(id: string): Promise<Customer | null>;
  abstract findDetailById(id: string): Promise<CustomerDetail | null>;
  abstract list(
    filter: CustomerFilter,
    window: PageWindow,
  ): Promise<CustomerPage>;
}
