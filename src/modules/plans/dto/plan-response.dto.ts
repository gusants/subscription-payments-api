import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PLAN_INTERVALS } from '../plan.js';

export const planResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  amountCents: z.number().int(),
  interval: z.enum(PLAN_INTERVALS),
  active: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export class PlanResponseDto extends createZodDto(planResponseSchema) {}
