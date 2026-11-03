import { createZodDto } from 'nestjs-zod';
import { paginatedResponseSchema } from '../../../shared/pagination/index.js';
import { planResponseSchema } from './plan-response.dto.js';

export class PlanListResponseDto extends createZodDto(
  paginatedResponseSchema(planResponseSchema),
) {}
