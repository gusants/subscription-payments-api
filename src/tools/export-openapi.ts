import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { sortKeys } from './sort-keys.js';

const OUTPUT_FILE = resolve(process.cwd(), 'openapi.json');

process.env['DATABASE_URL'] ??=
  'postgresql://openapi:openapi@localhost:5432/openapi';
process.env['REDIS_HOST'] ??= 'localhost';

const { AppModule } = await import('../app.module.js');
const { buildOpenApiDocument } =
  await import('../shared/http/setup-swagger.js');

const app = await NestFactory.create(AppModule, {
  preview: true,
  logger: false,
});
const document = sortKeys(buildOpenApiDocument(app));
await writeFile(OUTPUT_FILE, `${JSON.stringify(document, null, 2)}\n`);
await app.close();
