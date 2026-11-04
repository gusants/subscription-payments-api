import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { SubscriptionsService } from '../../modules/subscriptions/subscriptions.service.js';
import { ErrorResponseDto } from '../../shared/errors/error-response.js';
import { toGatewayChargeJson } from '../gateway-charge-json.js';
import { GatewayChargeResponseDto } from './dto/gateway-charge-response.dto.js';
import { ReplaceCardTokenDto } from './dto/replace-card-token.dto.js';
import { FakeGatewaySimulator } from './fake-gateway.simulator.js';
import { FakeGatewayStore } from './fake-gateway.store.js';

@ApiTags('fake-gateway')
@Controller('fake-gateway')
export class FakeGatewayController {
  constructor(
    private readonly store: FakeGatewayStore,
    private readonly simulator: FakeGatewaySimulator,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description: 'Development only: empties the fake gateway data file',
  })
  async reset(): Promise<void> {
    await this.store.reset();
  }

  @Post('charges/:id/pay')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({
    status: HttpStatus.OK,
    type: GatewayChargeResponseDto,
    description:
      'Development only: marks the pending pix or boleto gateway charge of our charge id as paid',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, type: ErrorResponseDto })
  async pay(@Param('id') id: string): Promise<GatewayChargeResponseDto> {
    return toGatewayChargeJson(await this.simulator.pay(id));
  }

  @Post('charges/:id/expire')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({
    status: HttpStatus.OK,
    type: GatewayChargeResponseDto,
    description:
      'Development only: marks the pending pix or boleto gateway charge of our charge id as expired',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, type: ErrorResponseDto })
  async expire(@Param('id') id: string): Promise<GatewayChargeResponseDto> {
    return toGatewayChargeJson(await this.simulator.expire(id));
  }

  @Post('subscriptions/:id/card')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description:
      'Development only: replaces the card token charged on the next attempt',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorResponseDto })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    type: ErrorResponseDto,
  })
  async replaceCardToken(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReplaceCardTokenDto)) body: ReplaceCardTokenDto,
  ): Promise<void> {
    await this.subscriptions.changeCardToken(id, body.cardToken);
  }
}
