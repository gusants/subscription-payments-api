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
import { Idempotent } from '../../shared/idempotency/index.js';
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
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  @ZodResponse({
    status: HttpStatus.OK,
    description:
      'The attempt ran. A failed charge is retried as a new attempt; a pending charge past its attempt lease is reconciled with the gateway. charge.status is paid or failed once the gateway decided, and stays pending when the gateway is unavailable, its outcome is unknown or it has not decided yet; retry again later',
    type: ChargeRetryResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid Idempotency-Key',
    type: ErrorResponseDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorResponseDto })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description:
      'The charge cannot be retried: it is paid, its subscription is canceled, it was modified concurrently, or it is pending with an attempt still in flight within the lease (CHARGE_ATTEMPT_LEASE_SECONDS); or a request with the same Idempotency-Key is still being processed',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description:
      'The subscription has no card token or the customer has no gateway customer; or the Idempotency-Key was already used with a different request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description:
      'An Idempotency-Key was sent and the idempotency store is unavailable',
    type: ErrorResponseDto,
  })
  async retry(@Param('id') id: string): Promise<ChargeRetryResponseDto> {
    return toChargeRetryResponse(await this.charges.retry(id));
  }
}
