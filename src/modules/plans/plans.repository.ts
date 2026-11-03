import type {
  NewPlan,
  PageWindow,
  Plan,
  PlanFilter,
  PlanPage,
} from './plan.js';

export abstract class PlansRepository {
  abstract create(plan: NewPlan): Promise<Plan>;
  abstract list(filter: PlanFilter, window: PageWindow): Promise<PlanPage>;
}
