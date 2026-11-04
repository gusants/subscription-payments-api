import type { DefaultJobOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';

const COMPLETED_JOBS_KEPT = 1000;
const COMPLETED_JOBS_MAX_AGE_SECONDS = 24 * 60 * 60;

export const BULLMQ_REDIS_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
};

export const BILLING_DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  removeOnComplete: {
    count: COMPLETED_JOBS_KEPT,
    age: COMPLETED_JOBS_MAX_AGE_SECONDS,
  },
  removeOnFail: false,
};
