import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject } from 'vitest';

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';
process.env['DATABASE_URL'] = inject('databaseUrl');
process.env['REDIS_HOST'] = inject('redisHost');
process.env['REDIS_PORT'] = String(inject('redisPort'));

const fakeGatewayDirectory = mkdtempSync(join(tmpdir(), 'fake-gateway-'));
process.env['FAKE_GATEWAY_DATA_FILE'] = join(
  fakeGatewayDirectory,
  'fake-gateway.json',
);
process.on('exit', () => {
  rmSync(fakeGatewayDirectory, { recursive: true, force: true });
});
