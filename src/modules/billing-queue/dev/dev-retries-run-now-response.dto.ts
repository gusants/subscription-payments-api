import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const devRetriesRunNowResponseSchema = z.object({
  promoted: z.number().int().nonnegative(),
});

export class DevRetriesRunNowResponseDto extends createZodDto(
  devRetriesRunNowResponseSchema,
) {}
