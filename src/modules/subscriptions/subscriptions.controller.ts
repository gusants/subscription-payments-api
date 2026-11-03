import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBody, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse, ZodValidationPipe } from 'nestjs-zod';
import { ErrorResponseDto } from '../../shared/errors/error-response.js';
import {
  CreateSubscriptionDto,
  type CreateSubscriptionBody,
} from './dto/create-subscription.dto.js';
import { CreatedSubscriptionResponseDto } from './dto/created-subscription-response.dto.js';
import { SubscriptionResponseDto } from './dto/subscription-response.dto.js';
import {
  toCreatedSubscriptionResponse,
  toSubscriptionResponse,
} from './subscription-presenter.js';
import { SubscriptionsService } from './subscriptions.service.js';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post()
  @ApiBody({ type: CreateSubscriptionDto })
  @ZodResponse({
    status: HttpStatus.CREATED,
    type: CreatedSubscriptionResponseDto,
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, type: ErrorResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorResponseDto })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    type: ErrorResponseDto,
  })
  async create(
    @Body(new ZodValidationPipe(CreateSubscriptionDto))
    body: CreateSubscriptionBody,
  ): Promise<CreatedSubscriptionResponseDto> {
    return toCreatedSubscriptionResponse(await this.subscriptions.create(body));
  }

  @Get(':id')
  @ZodResponse({ status: HttpStatus.OK, type: SubscriptionResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorResponseDto })
  async detail(@Param('id') id: string): Promise<SubscriptionResponseDto> {
    return toSubscriptionResponse(await this.subscriptions.getById(id));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ZodResponse({ status: HttpStatus.OK, type: SubscriptionResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, type: ErrorResponseDto })
  async cancel(@Param('id') id: string): Promise<SubscriptionResponseDto> {
    return toSubscriptionResponse(await this.subscriptions.cancel(id));
  }
}
