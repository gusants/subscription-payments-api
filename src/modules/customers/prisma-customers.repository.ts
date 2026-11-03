import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { ConflictError } from '../../shared/errors/index.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type {
  Customer,
  CustomerDetail,
  CustomerFilter,
  CustomerPage,
  NewCustomer,
  PageWindow,
} from './customer.js';
import { CustomersRepository } from './customers.repository.js';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

const customerFields = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CustomerSelect;

@Injectable()
export class PrismaCustomersRepository extends CustomersRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(customer: NewCustomer): Promise<Customer> {
    try {
      return await this.prisma.customer.create({
        data: customer,
        select: customerFields,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          `Customer with email ${customer.email} already exists`,
        );
      }
      throw error;
    }
  }

  findById(id: string): Promise<Customer | null> {
    return this.prisma.customer.findUnique({
      where: { id },
      select: customerFields,
    });
  }

  findDetailById(id: string): Promise<CustomerDetail | null> {
    return this.prisma.customer.findUnique({
      where: { id },
      select: {
        ...customerFields,
        subscriptions: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            planId: true,
            status: true,
            currentPeriodEnd: true,
          },
        },
      },
    });
  }

  async list(
    filter: CustomerFilter,
    { skip, take }: PageWindow,
  ): Promise<CustomerPage> {
    const where = toWhere(filter);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        select: customerFields,
        orderBy: { id: 'asc' },
        skip,
        take,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { items, total };
  }
}

function toWhere({
  search,
  subscriptionStatus,
}: CustomerFilter): Prisma.CustomerWhereInput {
  const term = search && escapeLikeWildcards(search);
  return {
    ...(term && {
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
      ],
    }),
    ...(subscriptionStatus && {
      subscriptions: { some: { status: subscriptionStatus } },
    }),
  };
}

function escapeLikeWildcards(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}
