/**
 * E2E test bootstrap. Runs inside the `bun` test container (see
 * devops/local/docker-compose-test.yaml) against the dockerized stack:
 *
 *   - `prisma migrate reset` so the schema matches HEAD.
 *   - `redis-cli FLUSHALL` clears queues + locks + nonce.
 *   - Fund the operator wallet on the anvil fork with xBZZ + xDAI via
 *     `fundOperatorFromEnv()` (anvil_setBalance + xBZZ whale impersonation).
 *     The contracts themselves already exist on the fork — they're managed
 *     by the t4t repo and live on Gnosis mainnet; the fork inherits them.
 *   - `evm_snapshot` so each spec can revert to a clean fork.
 */
import { $ } from 'bun';
import { redisConnection } from '../src/queue/connection';
import { fundOperatorFromEnv } from './fixtures/fundOperator';

let snapshotId: string | null = null;

export async function setBeforeAll(): Promise<void> {
  // The compose `prisma` service applied migrations on stack-up. Postgres uses
  // tmpfs in the test stack so each compose run starts fresh — within one
  // run we just need to clear Redis (BullMQ jobs + the operator nonce).
  await redisConnection.flushall();

  // Fund the operator wallet on the fork. Only needed for specs that settle a
  // chat completion on-chain (gateway / concurrency / cancellation). Auth /
  // accounts specs don't touch chain, so a funding failure is non-fatal here —
  // the chain specs will surface a clearer error later if they actually need it.
  try {
    await fundOperatorFromEnv();
  } catch (err: any) {
    console.warn(`[setup] fundOperatorFromEnv failed (non-fatal for non-chain specs): ${err.message}`);
  }

  snapshotId = await anvilSnapshot().catch(() => null);
}

export async function setAfterAll(): Promise<void> {
  if (snapshotId) await anvilRevert(snapshotId).catch(() => undefined);
  await redisConnection.quit();
}

async function anvilSnapshot(): Promise<string> {
  const res = await fetch(process.env.GNOSIS_RPC_URL ?? 'http://localhost:8545', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'evm_snapshot', params: [], id: 1 }),
  });
  const json = (await res.json()) as { result?: string };
  if (!json.result) throw new Error('evm_snapshot returned no id');
  return json.result;
}

async function anvilRevert(id: string): Promise<void> {
  await fetch(process.env.GNOSIS_RPC_URL ?? 'http://localhost:8545', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'evm_revert', params: [id], id: 1 }),
  });
}

// Bun auto-invokes the top-level `beforeAll` / `afterAll` from the preloaded
// setup file when called as `--preload`.
import { afterAll, beforeAll } from 'bun:test';
beforeAll(setBeforeAll);
afterAll(setAfterAll);
