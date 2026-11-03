import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type {
  NewPlan,
  PageWindow,
  Plan,
  PlanFilter,
  PlanPage,
} from './plan.js';
import { PlansRepository } from './plans.repository.js';

@Injectable()
export class PrismaPlansRepository extends PlansRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  create(plan: NewPlan): Promise<Plan> {
    return this.prisma.plan.create({ data: plan });
  }

  async list(
    filter: PlanFilter,
    { skip, take }: PageWindow,
  ): Promise<PlanPage> {
    const where = { active: filter.active };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.plan.findMany({
        where,
        orderBy: { id: 'asc' },
        skip,
        take,
      }),
      this.prisma.plan.count({ where }),
    ]);
    return { items, total };
  }
}
