import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../../shared/errors/error-response.js';
import { PaginationQueryDto } from '../../shared/pagination/index.js';
import {
  toChargeHistoryItemResponse,
  toChargeRetryResponse,
} from './charge-presenter.js';
import { ChargesService } from './charges.service.js';
import { ChargeHistoryResponseDto } from './dto/charge-history-response.dto.js';
import { ChargeRetryResponseDto } from './dto/charge-retry-response.dto.js';

@ApiTags('charges')
@Controller()
export class ChargesController {
  constructor(private readonly charges: ChargesService) {}

  @Get('customers/:id/charges')
  @ZodResponse({ status: HttpStatus.OK, type: ChargeHistoryResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, type: ErrorResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorResponseDto })
  async history(
    @Param('id') id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<ChargeHistoryResponseDto> {
    const { data, meta } = await this.charges.listByCustomer(id, query);
    return { data: data.map(toChargeHistoryItemResponse), meta };
  }

  @Post('charges/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ status: HttpStatus.OK, type: ChargeRetryResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, type: ErrorResponseDto })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    type: ErrorResponseDto,
  })
  async retry(@Param('id') id: string): Promise<ChargeRetryResponseDto> {
    return toChargeRetryResponse(await this.charges.retry(id));
  }
}
