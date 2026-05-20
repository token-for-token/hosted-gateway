import IORedis from 'ioredis';
import { env } from '../env';

export const redisConnection = new IORedis(env.REDIS_PORT, env.REDIS_HOST, {
  maxRetriesPerRequest: null,
});

export const queueConnection = { host: env.REDIS_HOST, port: env.REDIS_PORT };
