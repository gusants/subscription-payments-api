import { RandomSource } from '../fake/webhook/random-source.js';

export class SequenceRandomSource extends RandomSource {
  constructor(private readonly values: number[] = [0.5]) {
    super();
  }

  next(): number {
    return this.values.length > 1 ? this.values.shift()! : this.values[0]!;
  }
}
