import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { APP_OPTIONS } from '../../src/shared/http/app-options.js';

export function createTestApp<Server = unknown>(
  moduleRef: TestingModule,
): INestApplication<Server> {
  return moduleRef.createNestApplication<INestApplication<Server>>(APP_OPTIONS);
}
