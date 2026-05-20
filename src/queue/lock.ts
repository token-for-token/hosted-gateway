import { randomUUID } from 'crypto';
import { redisConnection } from './connection';

const DEFAULT_TTL = 30_000;
const RETRY_INTERVAL = 50;

/**
 * Distributed Redis lock using SET NX EX. Serializes critical sections across
 * api + worker processes — used for the operator wallet nonce
 * (`chain:operator`), claim-watcher leader election (`watcher:claim`), etc.
 */
export async function withLock<T>(
  key: string,
  fn: () => Promise<T>,
  ttl = DEFAULT_TTL,
): Promise<T> {
  const lockKey = `lock:${key}`;
  const lockValue = randomUUID();
  const ttlSeconds = Math.ceil(ttl / 1000);

  while (true) {
    const acquired = await redisConnection.set(lockKey, lockValue, 'EX', ttlSeconds, 'NX');
    if (acquired === 'OK') break;
    await new Promise((r) => setTimeout(r, RETRY_INTERVAL));
  }

  try {
    return await fn();
  } finally {
    await redisConnection.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      lockKey,
      lockValue,
    );
  }
}
