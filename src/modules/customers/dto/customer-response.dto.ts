import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const customerResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type CustomerResponse = z.infer<typeof customerResponseSchema>;

export class CustomerResponseDto extends createZodDto(customerResponseSchema) {}
