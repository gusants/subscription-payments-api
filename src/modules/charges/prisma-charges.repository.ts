import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { PageWindow } from '../customers/customer.js';
import type {
  ChargePage,
  ChargeWithAttempts,
  ChargeWithSubscription,
} from './charge.js';
import { ChargesRepository } from './charges.repository.js';

const withAttempts = {
  attempts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ChargeInclude;

type StoredCharge = Prisma.ChargeGetPayload<{ include: typeof withAttempts }>;

const toChargeWithAttempts = ({
  attempts,
  ...charge
}: StoredCharge): ChargeWithAttempts => ({ ...charge, attempts });

@Injectable()
export class PrismaChargesRepository extends ChargesRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findWithSubscription(
    id: string,
  ): Promise<ChargeWithSubscription | null> {
    const found = await this.prisma.charge.findUnique({
      where: { id },
      include: { subscription: true },
    });
    if (!found) return null;
    const { subscription, ...charge } = found;
    return { charge, subscription };
  }

  async findWithAttempts(id: string): Promise<ChargeWithAttempts | null> {
    const found = await this.prisma.charge.findUnique({
      where: { id },
      include: withAttempts,
    });
    return found && toChargeWithAttempts(found);
  }

  async listByCustomer(
    customerId: string,
    { skip, take }: PageWindow,
  ): Promise<ChargePage> {
    const where = { subscription: { customerId } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.charge.findMany({
        where,
        include: withAttempts,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.charge.count({ where }),
    ]);
    return { items: items.map(toChargeWithAttempts), total };
  }
}
