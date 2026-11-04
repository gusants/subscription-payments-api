import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  isOrderedPeriod,
  isWithinMaxSpan,
  MAX_PERIOD_DAYS,
  requestedPeriod,
} from '../domain/index.js';

const periodBoundSchema = z
  .union([z.iso.date(), z.iso.datetime({ offset: true })])
  .optional();

export const metricsOverviewQuerySchema = z
  .object({ from: periodBoundSchema, to: periodBoundSchema })
  .refine(({ from, to }) => Boolean(from) === Boolean(to), {
    message: 'from and to must be provided together',
    path: ['to'],
  })
  .refine(
    (query) => {
      const period = requestedPeriod(query);
      return !period || isOrderedPeriod(period);
    },
    { message: 'from must not be after to', path: ['from'] },
  )
  .refine(
    (query) => {
      const period = requestedPeriod(query);
      return !period || !isOrderedPeriod(period) || isWithinMaxSpan(period);
    },
    { message: `period must not exceed ${MAX_PERIOD_DAYS} days`, path: ['to'] },
  );

export class MetricsOverviewQueryDto extends createZodDto(
  metricsOverviewQuerySchema,
) {}
