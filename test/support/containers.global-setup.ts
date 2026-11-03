import { execFileSync } from 'node:child_process';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import {
  RedisContainer,
  type StartedRedisContainer,
} from '@testcontainers/redis';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisHost: string;
    redisPort: number;
  }
}

const POSTGRES_IMAGE = 'postgres:17-alpine';
const REDIS_IMAGE = 'redis:7.4-alpine';

function applyMigrations(databaseUrl: string) {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PRISMA_HIDE_UPDATE_MESSAGE: '1',
    },
    stdio: 'inherit',
  });
}

export default async function startContainers(project: TestProject) {
  const [postgres, redis]: [StartedPostgreSqlContainer, StartedRedisContainer] =
    await Promise.all([
      new PostgreSqlContainer(POSTGRES_IMAGE).start(),
      new RedisContainer(REDIS_IMAGE).start(),
    ]);

  const databaseUrl = postgres.getConnectionUri();
  applyMigrations(databaseUrl);

  project.provide('databaseUrl', databaseUrl);
  project.provide('redisHost', redis.getHost());
  project.provide('redisPort', redis.getPort());

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
