import { Injectable } from '@nestjs/common';
import { Clock } from './clock.js';

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
