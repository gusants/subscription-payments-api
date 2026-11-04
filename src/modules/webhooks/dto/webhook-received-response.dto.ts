import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const webhookReceivedResponseSchema = z.object({
  received: z.literal(true),
});

export class WebhookReceivedResponseDto extends createZodDto(
  webhookReceivedResponseSchema,
) {}
