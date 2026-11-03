import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../../shared/errors/error-response.js';
import { CreateSubscriptionDto } from './dto/create-subscription.dto.js';
import { SubscriptionResponseDto } from './dto/subscription-response.dto.js';
import { toSubscriptionResponse } from './subscription-presenter.js';
import { SubscriptionsService } from './subscriptions.service.js';

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post()
  @ZodResponse({ status: HttpStatus.CREATED, type: SubscriptionResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, type: ErrorResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorResponseDto })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    type: ErrorResponseDto,
  })
  async create(
    @Body() body: CreateSubscriptionDto,
  ): Promise<SubscriptionResponseDto> {
    return toSubscriptionResponse(await this.subscriptions.create(body));
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
