import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../../shared/errors/error-response.js';
import {
  toCustomerDetailResponse,
  toCustomerResponse,
} from './customer-presenter.js';
import { CustomersService } from './customers.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { CustomerDetailResponseDto } from './dto/customer-detail-response.dto.js';
import { CustomerListResponseDto } from './dto/customer-list-response.dto.js';
import { CustomerResponseDto } from './dto/customer-response.dto.js';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto.js';

@ApiTags('customers')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  @ZodResponse({ status: HttpStatus.CREATED, type: CustomerResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, type: ErrorResponseDto })
  @ApiResponse({ status: HttpStatus.CONFLICT, type: ErrorResponseDto })
  async create(@Body() body: CreateCustomerDto): Promise<CustomerResponseDto> {
    return toCustomerResponse(await this.customers.create(body));
  }

  @Get()
  @ZodResponse({ status: HttpStatus.OK, type: CustomerListResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, type: ErrorResponseDto })
  async list(
    @Query() query: ListCustomersQueryDto,
  ): Promise<CustomerListResponseDto> {
    const { data, meta } = await this.customers.list(query);
    return { data: data.map(toCustomerResponse), meta };
  }

  @Get(':id')
  @ZodResponse({ status: HttpStatus.OK, type: CustomerDetailResponseDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, type: ErrorResponseDto })
  async detail(@Param('id') id: string): Promise<CustomerDetailResponseDto> {
    return toCustomerDetailResponse(await this.customers.getDetail(id));
  }
}
