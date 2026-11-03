import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';

export const SWAGGER_PATH = 'docs';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Subscription Payments API')
    .setVersion('1.0')
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup(SWAGGER_PATH, app, buildOpenApiDocument(app));
}
