import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PLAN_INTERVALS } from '../plan.js';

export const createPlanSchema = z.object({
  name: z.string().trim().min(1),
  amountCents: z.number().int().positive(),
  interval: z.enum(PLAN_INTERVALS),
});

export class CreatePlanDto extends createZodDto(createPlanSchema) {}
