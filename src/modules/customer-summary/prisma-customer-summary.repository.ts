import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { CustomerPaymentRecord } from './customer-payment-record.js';
import { CustomerSummaryRepository } from './customer-summary.repository.js';
import { toCustomerPaymentRecord } from './prisma-customer-payment.mapper.js';

const paymentHistorySelect = {
  id: true,
  createdAt: true,
  subscriptions: {
    select: {
      createdAt: true,
      updatedAt: true,
      plan: {
        select: { interval: true, amountCents: true, updatedAt: true },
      },
      id: true,
      charges: {
        orderBy: { createdAt: 'asc' },
        select: {
          periodStart: true,
          status: true,
          method: true,
          amountCents: true,
          dueDate: true,
          paidAt: true,
          updatedAt: true,
          attempts: {
            select: { result: true, failureReason: true, createdAt: true },
          },
        },
      },
    },
  },
} satisfies Prisma.CustomerSelect;

@Injectable()
export class PrismaCustomerSummaryRepository extends CustomerSummaryRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findPaymentRecord(
    customerId: string,
  ): Promise<CustomerPaymentRecord | null> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: paymentHistorySelect,
    });
    return customer && toCustomerPaymentRecord(customer);
  }
}
