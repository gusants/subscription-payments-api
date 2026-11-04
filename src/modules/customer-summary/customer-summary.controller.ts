import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../../shared/errors/error-response.js';
import { toCustomerSummaryResponse } from './customer-summary-presenter.js';
import { CustomerSummaryService } from './customer-summary.service.js';
import { CustomerSummaryResponseDto } from './dto/customer-summary-response.dto.js';

@ApiTags('customers')
@Controller('customers')
export class CustomerSummaryController {
  constructor(private readonly summaries: CustomerSummaryService) {}

  @Get(':id/summary')
  @ZodResponse({ status: HttpStatus.OK, type: CustomerSummaryResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorResponseDto })
  async summary(@Param('id') id: string): Promise<CustomerSummaryResponseDto> {
    return toCustomerSummaryResponse(await this.summaries.getSummary(id));
  }
}
