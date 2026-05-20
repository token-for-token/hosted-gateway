/**
 * Shared E2E helpers. Tests run inside the dockerized stack — the api/worker
 * are reachable as service names on the compose network.
 *
 * Pattern lifted from cipherdolls/core/test/helpers.ts: a single `api(...)`
 * wrapper around fetch, a `waitForQueuesEmpty()` poller for the
 * model.x.create → BullMQ → processor pipeline, and persona-style auth
 * records keyed in a shared `auth` table.
 */
import IORedis from 'ioredis';

export const BASE_URL = process.env.HOSTED_GATEWAY_URL ?? 'http://localhost:8080';
const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT ?? '6379');

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiResult<T = any> {
  status: number;
  body: T;
}

/**
 * Issue an HTTP request to the hosted-gateway api. Accepts either a JWT or an
 * API key (bare uuid OR the `t4t-live-<uuid>` form) as `auth`.
 */
export async function api<T = any>(
  method: HttpMethod,
  path: string,
  auth?: string,
  body?: any,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${auth}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = text;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, body: parsed as T };
}

export const get = (path: string, auth?: string) => api('GET', path, auth);
export const post = (path: string, body: any, auth?: string) => api('POST', path, auth, body);
export const del = (path: string, auth?: string) => api('DELETE', path, auth);

/**
 * Wait until all BullMQ queues are empty AND stay empty for `settleMs` —
 * defends against cascades where one processor enqueues the next (eg
 * user.created → account.created → ledger welcomeGrant).
 */
export async function waitForQueuesEmpty(
  timeoutMs = 15_000,
  settleMs = 500,
): Promise<void> {
  const redis = new IORedis(REDIS_PORT, REDIS_HOST, { maxRetriesPerRequest: null });
  const interval = 100;
  let elapsed = 0;
  let emptyFor = 0;
  try {
    while (elapsed < timeoutMs) {
      const queueKeys = [
        ...(await redis.keys('bull:*:waiting')),
        ...(await redis.keys('bull:*:active')),
        ...(await redis.keys('bull:*:delayed')),
      ];
      let total = 0;
      for (const key of queueKeys) {
        const type = await redis.type(key);
        if (type === 'list') total += await redis.llen(key);
        else if (type === 'zset') total += await redis.zcard(key);
      }
      if (total === 0) {
        emptyFor += interval;
        if (emptyFor >= settleMs) return;
      } else {
        emptyFor = 0;
      }
      await new Promise((r) => setTimeout(r, interval));
      elapsed += interval;
    }
    throw new Error(`queues not empty after ${timeoutMs}ms`);
  } finally {
    redis.disconnect();
  }
}

/* ────────────────────────────────────────────────────────────────
   Auth flow helpers — mirror cipherdolls' signIn / createApiKey shape,
   but for email/password (Phase 1 doesn't wire real Google OAuth in tests).
   ──────────────────────────────────────────────────────────────── */

export interface AuthRecord {
  email: string;
  password: string;
  jwt: string;
  userId: string;
  apiKey: string;
  apiKeyId: string;
}

/** Persona registry — populated by `describe*()` factories and read by
 *  downstream specs. New personas added as the test suite grows. */
export const auth: Record<string, Partial<AuthRecord>> = {
  alice: {},
  bob: {},
  carol: {},
  dave: {},
};

export async function signupEmail(
  email: string,
  password: string,
): Promise<{ jwt: string; userId: string; verificationToken: string }> {
  const { status, body } = await post('/auth/email/signup', { email, password });
  if (status !== 200) throw new Error(`signup ${email} failed: ${status} ${JSON.stringify(body)}`);
  return { jwt: body.token, userId: body.user.id, verificationToken: body.verificationToken };
}

export async function verifyEmail(token: string): Promise<void> {
  const { status, body } = await post('/auth/email/verify', { token });
  if (status !== 200) throw new Error(`verify failed: ${status} ${JSON.stringify(body)}`);
}

export async function loginEmail(
  email: string,
  password: string,
): Promise<{ jwt: string; userId: string }> {
  const { status, body } = await post('/auth/email/login', { email, password });
  if (status !== 200) throw new Error(`login ${email} failed: ${status} ${JSON.stringify(body)}`);
  return { jwt: body.token, userId: body.user.id };
}

export async function createApiKey(
  jwt: string,
  name: string,
): Promise<{ id: string; key: string }> {
  const { status, body } = await post('/api-keys', { name }, jwt);
  if (status !== 200) throw new Error(`createApiKey failed: ${status} ${JSON.stringify(body)}`);
  return { id: body.id, key: body.key };
}
