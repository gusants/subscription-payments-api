import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { SIGNATURE_HEADER } from '../../gateway/index.js';
import { ErrorResponseDto } from '../../shared/errors/error-response.js';
import { GatewayWebhookDto } from './dto/gateway-webhook.dto.js';
import { WebhookReceivedResponseDto } from './dto/webhook-received-response.dto.js';
import { GatewaySignatureGuard } from './gateway-signature.guard.js';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  @Post('gateway')
  @HttpCode(HttpStatus.OK)
  @UseGuards(GatewaySignatureGuard)
  @ApiHeader({
    name: SIGNATURE_HEADER,
    required: true,
    description:
      'Internal endpoint called by the payment gateway. Format t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>." + raw body>. Rejected with 401 when missing, malformed, mismatched or when t is more than 5 minutes away from the server clock',
  })
  @ZodResponse({
    status: HttpStatus.OK,
    description: 'The event was received',
    type: WebhookReceivedResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'The signature is valid but the payload is not a gateway event',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description:
      'The signature header is missing, invalid or out of the allowed window',
    type: ErrorResponseDto,
  })
  receive(@Body() _event: GatewayWebhookDto): WebhookReceivedResponseDto {
    return { received: true };
  }
}
