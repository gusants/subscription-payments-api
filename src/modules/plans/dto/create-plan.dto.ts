import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MAX_AMOUNT_CENTS, PLAN_INTERVALS } from '../plan.js';

export const createPlanSchema = z.object({
  name: z.string().trim().min(1),
  amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS),
  interval: z.enum(PLAN_INTERVALS),
});

export class CreatePlanDto extends createZodDto(createPlanSchema) {}
