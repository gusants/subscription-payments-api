import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FakeGatewayStore,
  type FakeGatewayData,
} from './fake-gateway.store.js';

const customer = (id: string) => ({
  id,
  externalRef: `ref_${id}`,
  name: 'Ana',
  email: 'ana@example.com',
  createdAt: '2026-11-03T10:00:00.000Z',
});

const readJson = async (path: string): Promise<FakeGatewayData> =>
  JSON.parse(await readFile(path, 'utf8')) as FakeGatewayData;

describe('FakeGatewayStore', () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'fake-gateway-'));
    filePath = join(directory, 'nested', 'fake-gateway.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads empty data when the file does not exist yet', async () => {
    const store = new FakeGatewayStore(filePath);

    expect(await store.read((data) => data)).toEqual({
      customers: [],
      charges: [],
      events: [],
    });
  });

  it('creates the directory and file on first write', async () => {
    const store = new FakeGatewayStore(filePath);

    await store.transaction((data) => data.customers.push(customer('a')));

    expect((await readJson(filePath)).customers).toHaveLength(1);
  });

  it('reads its own writes', async () => {
    const store = new FakeGatewayStore(filePath);

    await store.transaction((data) => data.customers.push(customer('a')));

    expect(await store.read((data) => data.customers.length)).toBe(1);
  });

  it('persists across store instances', async () => {
    await new FakeGatewayStore(filePath).transaction((data) =>
      data.customers.push(customer('a')),
    );

    const customers = await new FakeGatewayStore(filePath).read(
      (data) => data.customers,
    );

    expect(customers.map(({ id }) => id)).toEqual(['a']);
  });

  it('serializes concurrent writes without losing any', async () => {
    const store = new FakeGatewayStore(filePath);

    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        store.transaction((data) => data.customers.push(customer(`c${index}`))),
      ),
    );

    expect((await readJson(filePath)).customers).toHaveLength(50);
  });

  it('keeps the file parseable while writes are in flight', async () => {
    const store = new FakeGatewayStore(filePath);
    await store.transaction((data) => data.customers.push(customer('seed')));

    const writes = Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        store.transaction((data) => data.customers.push(customer(`c${index}`))),
      ),
    );
    const snapshots: FakeGatewayData[] = [];
    while (snapshots.length < 30) {
      snapshots.push(await readJson(filePath));
    }
    await writes;

    expect(snapshots.every(({ customers }) => customers.length >= 1)).toBe(
      true,
    );
  });

  it('leaves no temporary file behind', async () => {
    const store = new FakeGatewayStore(filePath);

    await store.transaction((data) => data.customers.push(customer('a')));

    expect(await readdir(join(directory, 'nested'))).toEqual([
      'fake-gateway.json',
    ]);
  });

  it('keeps the previous content when a transaction fails', async () => {
    const store = new FakeGatewayStore(filePath);
    await store.transaction((data) => data.customers.push(customer('a')));

    await expect(
      store.transaction((data) => {
        data.customers.push(customer('b'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect((await readJson(filePath)).customers).toHaveLength(1);
  });

  it('keeps processing after a failed transaction', async () => {
    const store = new FakeGatewayStore(filePath);
    await store
      .transaction(() => {
        throw new Error('boom');
      })
      .catch(() => undefined);

    await store.transaction((data) => data.customers.push(customer('a')));

    expect(await store.read((data) => data.customers.length)).toBe(1);
  });

  it('resets to empty data', async () => {
    const store = new FakeGatewayStore(filePath);
    await store.transaction((data) => data.customers.push(customer('a')));

    await store.reset();

    expect(await readJson(filePath)).toEqual({
      customers: [],
      charges: [],
      events: [],
    });
  });

  it('rejects a corrupted file instead of silently resetting it', async () => {
    const store = new FakeGatewayStore(filePath);
    await store.reset();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(filePath, '{not json');

    await expect(store.read((data) => data)).rejects.toThrow();
  });
});
