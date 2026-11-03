export const PLAN_INTERVALS = ['monthly', 'yearly'] as const;

export type PlanInterval = (typeof PLAN_INTERVALS)[number];

export interface Plan {
  id: string;
  name: string;
  amountCents: number;
  interval: PlanInterval;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type NewPlan = Pick<Plan, 'id' | 'name' | 'amountCents' | 'interval'>;

export interface PlanFilter {
  active?: boolean;
}

export interface PageWindow {
  skip: number;
  take: number;
}

export interface PlanPage {
  items: Plan[];
  total: number;
}
