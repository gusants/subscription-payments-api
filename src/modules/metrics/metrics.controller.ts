import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../../shared/errors/error-response.js';
import { requestedPeriod } from './domain/index.js';
import { MetricsOverviewQueryDto } from './dto/metrics-overview-query.dto.js';
import { MetricsOverviewResponseDto } from './dto/metrics-overview-response.dto.js';
import { toMetricsOverviewResponse } from './metrics-presenter.js';
import { MetricsService } from './metrics.service.js';

@ApiTags('metrics')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Revenue and subscription health overview',
    description:
      'Current state, not filtered by from/to: monthlyRecurringRevenueCents, activeSubscriptions, pastDueSubscriptions and subscriptionsByStatus. Bounded by from/to: revenueByMonth and the payment-failure cancellations inside delinquencyRate. Without from/to the period is the current UTC calendar month. The figures are read in one RepeatableRead transaction.',
  })
  @ZodResponse({ status: HttpStatus.OK, type: MetricsOverviewResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, type: ErrorResponseDto })
  async overview(
    @Query() query: MetricsOverviewQueryDto,
  ): Promise<MetricsOverviewResponseDto> {
    return toMetricsOverviewResponse(
      await this.metrics.getOverview(requestedPeriod(query)),
    );
  }
}
