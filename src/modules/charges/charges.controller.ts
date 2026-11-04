import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
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
      'A pending charge past its attempt lease was reconciled with the gateway inline. charge.status is paid or failed once the gateway decided, and stays pending when the gateway is unavailable, its outcome is unknown or it has not decided yet; retry again later',
    type: ChargeRetryResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description:
      'A failed charge, or an expired pix/boleto charge that is the newest of its period (a new charge is issued for the period): the next dunning retry was queued to run now (same deterministic job as the scheduled retry, so it never runs twice) and the body shows the charge as it is at this moment, still failed or expired. The worker settles it asynchronously; poll the customer charge history',
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
      'The charge cannot be retried: it is paid or uncollectible, it is expired but superseded by a newer charge of the same period, its subscription is canceled, it has used its dunning retries, it was modified concurrently, or it is pending with an attempt still in flight within the lease (CHARGE_ATTEMPT_LEASE_SECONDS); or a request with the same Idempotency-Key is still being processed',
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
      'The retry queue is unavailable (nothing was queued; the same Idempotency-Key can be sent again), or an Idempotency-Key was sent and the idempotency store is unavailable',
    type: ErrorResponseDto,
  })
  async retry(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ChargeRetryResponseDto> {
    const result = await this.charges.retry(id);
    if (result.queued) response.status(HttpStatus.ACCEPTED);
    return toChargeRetryResponse(result);
  }
}
