import type { Plan } from './plan.js';
import type { PlanResponseDto } from './dto/plan-response.dto.js';

export function toPlanResponse(plan: Plan): PlanResponseDto {
  return {
    ...plan,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}
