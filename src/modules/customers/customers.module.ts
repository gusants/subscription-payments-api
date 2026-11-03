import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomersService } from './customers.service.js';
import { PrismaCustomersRepository } from './prisma-customers.repository.js';

@Module({
  controllers: [CustomersController],
  providers: [
    CustomersService,
    { provide: CustomersRepository, useClass: PrismaCustomersRepository },
  ],
})
export class CustomersModule {}
