import { Body, Controller, Get, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../../shared/errors/error-response.js';
import { CreatePlanDto } from './dto/create-plan.dto.js';
import { ListPlansQueryDto } from './dto/list-plans-query.dto.js';
import { PlanListResponseDto } from './dto/plan-list-response.dto.js';
import { PlanResponseDto } from './dto/plan-response.dto.js';
import { toPlanResponse } from './plan-presenter.js';
import { PlansService } from './plans.service.js';

@ApiTags('plans')
@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Post()
  @ZodResponse({ status: HttpStatus.CREATED, type: PlanResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, type: ErrorResponseDto })
  async create(@Body() body: CreatePlanDto): Promise<PlanResponseDto> {
    return toPlanResponse(await this.plans.create(body));
  }

  @Get()
  @ZodResponse({ status: HttpStatus.OK, type: PlanListResponseDto })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, type: ErrorResponseDto })
  async list(@Query() query: ListPlansQueryDto): Promise<PlanListResponseDto> {
    const { data, meta } = await this.plans.list(query);
    return { data: data.map(toPlanResponse), meta };
  }
}
