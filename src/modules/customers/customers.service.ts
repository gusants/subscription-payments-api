import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../shared/errors/index.js';
import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import {
  paginate,
  toSkipTake,
  type Paginated,
  type PaginationQuery,
} from '../../shared/pagination/index.js';
import type { Customer, CustomerDetail, CustomerFilter } from './customer.js';
import { CustomersRepository } from './customers.repository.js';

export interface CreateCustomerInput {
  name: string;
  email: string;
}

@Injectable()
export class CustomersService {
  constructor(private readonly customers: CustomersRepository) {}

  create(input: CreateCustomerInput): Promise<Customer> {
    return this.customers.create({
      id: generateId(ID_PREFIXES.customer),
      ...input,
    });
  }

  async list(
    query: PaginationQuery & CustomerFilter,
  ): Promise<Paginated<Customer>> {
    const { search, subscriptionStatus } = query;
    const { items, total } = await this.customers.list(
      { search, subscriptionStatus },
      toSkipTake(query),
    );
    return paginate(items, total, query);
  }

  async getDetail(id: string): Promise<CustomerDetail> {
    const customer = await this.customers.findDetailById(id);
    if (!customer) {
      throw new NotFoundError(`Customer ${id} not found`);
    }
    return customer;
  }
}
