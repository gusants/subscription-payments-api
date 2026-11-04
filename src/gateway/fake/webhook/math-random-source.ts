import { Injectable } from '@nestjs/common';
import { RandomSource } from './random-source.js';

@Injectable()
export class MathRandomSource extends RandomSource {
  next(): number {
    return Math.random();
  }
}
