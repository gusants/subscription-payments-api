import { inject } from 'vitest';

process.env['NODE_ENV'] = 'test';
process.env['LOG_LEVEL'] = 'silent';
process.env['DATABASE_URL'] = inject('databaseUrl');
process.env['REDIS_HOST'] = inject('redisHost');
process.env['REDIS_PORT'] = String(inject('redisPort'));
