import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller.js';
import { MetricsRepository } from './metrics.repository.js';
import { MetricsService } from './metrics.service.js';
import { PrismaMetricsRepository } from './prisma-metrics.repository.js';

@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: MetricsRepository, useClass: PrismaMetricsRepository },
  ],
})
export class MetricsModule {}
