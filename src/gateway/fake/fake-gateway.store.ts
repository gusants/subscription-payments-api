import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  GatewayChargeMethod,
  GatewayChargeStatus,
  GatewayFailureReason,
} from '../payment-gateway.port.js';

export interface StoredGatewayCustomer {
  id: string;
  externalRef: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface StoredGatewayCharge {
  id: string;
  customerId: string;
  externalRef: string;
  amountCents: number;
  method: GatewayChargeMethod;
  cardToken: string;
  status: GatewayChargeStatus;
  failureReason?: GatewayFailureReason;
  createdAt: string;
}

export interface FakeGatewayData {
  customers: StoredGatewayCustomer[];
  charges: StoredGatewayCharge[];
  events: unknown[];
}

const emptyData = (): FakeGatewayData => ({
  customers: [],
  charges: [],
  events: [],
});

const isMissingFile = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export class FakeGatewayStore {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  read<T>(select: (data: FakeGatewayData) => T): Promise<T> {
    return this.enqueue(async () => select(await this.load()));
  }

  transaction<T>(mutate: (data: FakeGatewayData) => T): Promise<T> {
    return this.enqueue(async () => {
      const data = await this.load();
      const result = mutate(data);
      await this.persist(data);
      return result;
    });
  }

  reset(): Promise<void> {
    return this.enqueue(() => this.persist(emptyData()));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async load(): Promise<FakeGatewayData> {
    try {
      const content = await readFile(this.filePath, 'utf8');
      return { ...emptyData(), ...(JSON.parse(content) as FakeGatewayData) };
    } catch (error) {
      if (isMissingFile(error)) return emptyData();
      throw error;
    }
  }

  private async persist(data: FakeGatewayData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(data, null, 2));
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
