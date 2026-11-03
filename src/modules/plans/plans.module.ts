import { Module } from '@nestjs/common';
import { PlansController } from './plans.controller.js';
import { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';
import { PrismaPlansRepository } from './prisma-plans.repository.js';

@Module({
  controllers: [PlansController],
  providers: [
    PlansService,
    { provide: PlansRepository, useClass: PrismaPlansRepository },
  ],
})
export class PlansModule {}
