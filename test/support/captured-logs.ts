import { Writable } from 'node:stream';

export type LogLine = Record<string, unknown>;

export class CapturedLogs extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  raw(): string {
    return this.chunks.join('');
  }

  lines(): LogLine[] {
    return this.raw()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as LogLine);
  }

  clear(): void {
    this.chunks.length = 0;
  }
}
