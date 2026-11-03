import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const errorResponseSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  details: z.array(z.unknown()).optional(),
});

export class ErrorResponseDto extends createZodDto(errorResponseSchema) {}

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
