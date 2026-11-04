import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../../../shared/errors/error-response.js';
import { DevRetriesRunNowResponseDto } from './dev-retries-run-now-response.dto.js';
import { DevRetriesService } from './dev-retries.service.js';

@ApiTags('dev')
@Controller('dev/retries')
export class DevRetriesController {
  constructor(private readonly retries: DevRetriesService) {}

  @Post('run-now')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({
    status: HttpStatus.OK,
    type: DevRetriesRunNowResponseDto,
    description:
      'Development only: promotes every delayed dunning retry job to run now and returns how many were promoted. The worker settles them asynchronously',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    type: ErrorResponseDto,
  })
  async runNow(): Promise<DevRetriesRunNowResponseDto> {
    return { promoted: await this.retries.runNow() };
  }
}
