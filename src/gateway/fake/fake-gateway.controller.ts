import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { FakeGatewayStore } from './fake-gateway.store.js';

@ApiTags('fake-gateway')
@Controller('fake-gateway')
export class FakeGatewayController {
  constructor(private readonly store: FakeGatewayStore) {}

  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description: 'Development only: empties the fake gateway data file',
  })
  async reset(): Promise<void> {
    await this.store.reset();
  }
}
