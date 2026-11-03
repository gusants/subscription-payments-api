import { ConfigService } from '@nestjs/config';
import type { Env } from '../../src/shared/config/env.schema.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';

export function createPrismaService(): PrismaService {
  const config = new ConfigService<Env, true>({
    DATABASE_URL: process.env['DATABASE_URL'],
  });
  return new PrismaService(config);
}
