import { Injectable } from '@nestjs/common';
import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import {
  paginate,
  toSkipTake,
  type Paginated,
  type PaginationQuery,
} from '../../shared/pagination/index.js';
import type { Plan, PlanFilter, PlanInterval } from './plan.js';
import { PlansRepository } from './plans.repository.js';

export interface CreatePlanInput {
  name: string;
  amountCents: number;
  interval: PlanInterval;
}

@Injectable()
export class PlansService {
  constructor(private readonly plans: PlansRepository) {}

  create(input: CreatePlanInput): Promise<Plan> {
    return this.plans.create({ id: generateId(ID_PREFIXES.plan), ...input });
  }

  async list(query: PaginationQuery & PlanFilter): Promise<Paginated<Plan>> {
    const { items, total } = await this.plans.list(
      { active: query.active },
      toSkipTake(query),
    );
    return paginate(items, total, query);
  }
}
