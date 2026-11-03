import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type {
  NewSubscription,
  StatusChange,
  Subscription,
} from './subscription.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

@Injectable()
export class PrismaSubscriptionsRepository extends SubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  create(subscription: NewSubscription): Promise<Subscription> {
    return this.prisma.subscription.create({ data: subscription });
  }

  findById(id: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({ where: { id } });
  }

  async changeStatus(
    id: string,
    { fromAnyOf, to, canceledAt }: StatusChange,
  ): Promise<Subscription | null> {
    const { count } = await this.prisma.subscription.updateMany({
      where: { id, status: { in: [...fromAnyOf] } },
      data: { status: to, ...(canceledAt && { canceledAt }) },
    });
    return count === 0 ? null : this.findById(id);
  }
}
