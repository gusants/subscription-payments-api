import { createZodDto } from 'nestjs-zod';
import { gatewayChargeJsonSchema } from '../../gateway-charge-json.js';

export class GatewayChargeResponseDto extends createZodDto(
  gatewayChargeJsonSchema,
) {}
