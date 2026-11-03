import { createZodDto } from 'nestjs-zod';
import { paginatedResponseSchema } from '../../../shared/pagination/index.js';
import { customerResponseSchema } from './customer-response.dto.js';

export class CustomerListResponseDto extends createZodDto(
  paginatedResponseSchema(customerResponseSchema),
) {}
