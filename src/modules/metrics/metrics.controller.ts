import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
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
