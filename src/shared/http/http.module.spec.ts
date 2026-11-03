import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { HttpModule } from './http.module.js';

class GreetingDto extends createZodDto(z.object({ greeting: z.string() })) {}

@Controller('greetings')
class GreetingsController {
  @Get('extra')
  @ZodResponse({ type: GreetingDto })
  withExtraField() {
    return { greeting: 'hi', secret: 'leak' };
  }

  @Get('invalid')
  @ZodResponse({ type: GreetingDto })
  invalid() {
    return { greeting: 42 } as unknown as GreetingDto;
  }
}

describe('HttpModule response validation', () => {
  async function createApp() {
    const moduleRef = await Test.createTestingModule({
      imports: [HttpModule],
      controllers: [GreetingsController],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return app;
  }

  it('strips fields outside the response schema', async () => {
    const app = await createApp();

    const response = await request(app.getHttpServer())
      .get('/greetings/extra')
      .expect(200);
    await app.close();

    expect(response.body).toEqual({ greeting: 'hi' });
  });

  it('answers 500 when the output violates the response schema', async () => {
    const app = await createApp();

    const response = await request(app.getHttpServer())
      .get('/greetings/invalid')
      .expect(500);
    await app.close();

    expect(response.body).toMatchObject({
      statusCode: 500,
      error: 'Internal Server Error',
    });
  });
});
