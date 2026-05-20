/**
 * Operator-wallet chain writes, serialized via `withLock('chain:operator')`.
 *
 * One operator wallet = one nonce stream. Many concurrent users hitting
 * `/v1/chat/completions` means many `postJob` / `ensureAllowance` calls fan in;
 * without serialization, viem submits them concurrently and the second tx
 * collides on nonce. The lock holds only for submission (until the tx hash
 * comes back), not until the receipt — so this never bottlenecks PSS-flight or
 * Swarm transfers.
 */
import type { Hex } from 'viem';
import type { Address } from 'viem';
import type { ChainClient } from '../t4t/lib/chain';
import {
  cancelJob as cancelJobRaw,
  ensureAllowance as ensureAllowanceRaw,
  postJob as postJobRaw,
  timeoutJob as timeoutJobRaw,
} from '../t4t/lib/chain';
import { withLock } from '../queue/lock';

const OPERATOR_LOCK = 'chain:operator';

export function ensureAllowance(c: ChainClient, spender: Address, needed: bigint): Promise<void> {
  return withLock(OPERATOR_LOCK, () => ensureAllowanceRaw(c, spender, needed));
}

export function postJob(
  c: ChainClient,
  args: {
    provider: Address;
    requestHash: Hex;
    modelId: string;
    maxPayment: bigint;
    deliveryDeadline: number;
  },
): Promise<{ txHash: Hex; jobId: Hex }> {
  return withLock(OPERATOR_LOCK, () => postJobRaw(c, args));
}

export function cancelJob(c: ChainClient, jobId: Hex): Promise<Hex> {
  return withLock(OPERATOR_LOCK, () => cancelJobRaw(c, jobId));
}

export function timeoutJob(c: ChainClient, jobId: Hex): Promise<Hex> {
  return withLock(OPERATOR_LOCK, () => timeoutJobRaw(c, jobId));
}
