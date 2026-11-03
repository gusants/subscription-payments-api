import { createZodDto } from 'nestjs-zod';
import { paginatedResponseSchema } from '../../../shared/pagination/index.js';
import { chargeHistoryItemResponseSchema } from './charge-history-item-response.dto.js';

export class ChargeHistoryResponseDto extends createZodDto(
  paginatedResponseSchema(chargeHistoryItemResponseSchema),
) {}
