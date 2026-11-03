import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createCustomerSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export class CreateCustomerDto extends createZodDto(createCustomerSchema) {}
