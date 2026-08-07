/**
 * Polls `JobEscrow.JobClaimed` events (the on-chain source of truth for
 * `actualPayment`) and settles the off-chain ledger by joining on
 * `GatewayJob.onChainJobId`.
 *
 * Leader-locked via `withLock('watcher:claim')` so multiple worker replicas
 * don't double-settle. Uses `getContractEvents` over a sliding [last, current]
 * block window — survives stateless public RPCs that forget filter ids
 * (rpc.gnosischain.com behavior).
 */
import type { Hex } from 'viem';
import { jobEscrowAbi } from '../t4t/lib/abi';
import { withLock } from '../queue/lock';
import { redisConnection } from '../queue/connection';
import { logger } from '../logger';
import { prisma } from '../db';
import { settleXbzz } from '../accounts/ledger';
import { weiToBigInt } from '../lib/decimal';
import { applyMarkup } from '../pricing/estimate';
import { getGatewayContext } from '../gateway/context';

const POLL_INTERVAL_MS = 10_000;
const LEADER_LOCK = 'watcher:claim';
const LEADER_TTL_MS = 30_000;
const LAST_BLOCK_KEY = 'watcher:claim:lastBlock';

export function startClaimWatcher(): void {
  setInterval(() => {
    tick().catch((err) => logger.warn({ err: err.message }, 'claimWatcher tick failed'));
  }, POLL_INTERVAL_MS).unref();
  logger.info('claimWatcher started');
}

async function tick(): Promise<void> {
  // Run only if we hold the leader lock; otherwise another replica is the
  // active watcher. withLock retries internally, which is fine — the interval
  // tick is idempotent.
  await withLock(LEADER_LOCK, doPoll, LEADER_TTL_MS);
}

async function doPoll(): Promise<void> {
  const ctx = await getGatewayContext();
  const chain = ctx.chain;

  const stored = await redisConnection.get(LAST_BLOCK_KEY);
  let lastBlock: bigint;
  if (stored) {
    lastBlock = BigInt(stored);
  } else {
    lastBlock = await chain.pub.getBlockNumber();
    await redisConnection.set(LAST_BLOCK_KEY, lastBlock.toString());
  }

  const current = await chain.pub.getBlockNumber();
  if (current <= lastBlock) return;

  // Cap each batch to 5_000 blocks so we don't hammer the RPC after a long
  // restart pause (5_000 blocks at ~5s/block ≈ 7 hours of lookback).
  const toBlock = current > lastBlock + 5_000n ? lastBlock + 5_000n : current;

  // JobClaimed → settle ledger. The JobEscrow ABI only exposes JobPosted and
  // JobClaimed events; cancel/timeout settlement is reconciled in-process by
  // the failure timers in `gateway/context.ts`. A future contract revision
  // can add `JobCancelled` / `JobTimedOut` and this watcher will pick them up
  // — for now the only event we tail is JobClaimed.
  const claimed = await chain.pub.getContractEvents({
    address: chain.escrow,
    abi: jobEscrowAbi,
    eventName: 'JobClaimed',
    fromBlock: lastBlock + 1n,
    toBlock,
  });
  for (const ev of claimed) {
    await handleClaimed(ev.args.jobId as Hex | undefined, ev.args.paid as bigint | undefined);
  }

  await redisConnection.set(LAST_BLOCK_KEY, toBlock.toString());
}

async function handleClaimed(jobId: Hex | undefined, paid: bigint | undefined): Promise<void> {
  if (!jobId || paid === undefined) return;
  const job = await prisma.gatewayJob.findUnique({
    where: { onChainJobId: jobId },
    select: { id: true, userId: true, status: true, estimatedMaxXbzzWei: true },
  });
  if (!job) {
    logger.debug({ jobId }, 'JobClaimed for unknown onChainJobId — skipping');
    return;
  }
  if (job.status === 'claimed') return; // idempotent

  const estimateWithMarkup = weiToBigInt(job.estimatedMaxXbzzWei);
  const actualWithMarkup = applyMarkup(paid);

  await settleXbzz(job.userId, job.id, estimateWithMarkup, actualWithMarkup);
  await prisma.gatewayJob.update({
    where: { id: job.id },
    data: {
      status: 'claimed',
      actualXbzzWei: actualWithMarkup.toString(),
      claimedAt: new Date(),
    },
  });
  logger.info(
    { gatewayJobId: job.id, userId: job.userId, paid: paid.toString(), actualWithMarkup: actualWithMarkup.toString() },
    'JobClaimed settled',
  );
}

