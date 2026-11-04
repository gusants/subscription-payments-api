import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const replaceCardTokenSchema = z.object({
  cardToken: z.string().trim().min(1).max(255),
});

export class ReplaceCardTokenDto extends createZodDto(replaceCardTokenSchema) {}
