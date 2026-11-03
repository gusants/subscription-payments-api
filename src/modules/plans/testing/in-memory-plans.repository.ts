import type {
  NewPlan,
  PageWindow,
  Plan,
  PlanFilter,
  PlanPage,
} from '../plan.js';
import { PlansRepository } from '../plans.repository.js';

export class InMemoryPlansRepository extends PlansRepository {
  private readonly plans: Plan[] = [];

  create(plan: NewPlan): Promise<Plan> {
    const now = new Date();
    const created: Plan = {
      ...plan,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    this.plans.push(created);
    return Promise.resolve(created);
  }

  list(filter: PlanFilter, { skip, take }: PageWindow): Promise<PlanPage> {
    const matching = this.plans
      .filter(
        (plan) => filter.active === undefined || plan.active === filter.active,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    return Promise.resolve({
      items: matching.slice(skip, skip + take),
      total: matching.length,
    });
  }

  deactivate(id: string): void {
    const plan = this.plans.find((candidate) => candidate.id === id);
    if (plan) plan.active = false;
  }
}
