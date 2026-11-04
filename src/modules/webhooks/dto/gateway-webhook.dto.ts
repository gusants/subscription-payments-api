import { createZodDto } from 'nestjs-zod';
import { gatewayWebhookPayloadSchema } from '../../../gateway/index.js';

export class GatewayWebhookDto extends createZodDto(
  gatewayWebhookPayloadSchema,
) {}
