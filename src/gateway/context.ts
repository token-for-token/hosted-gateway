/**
 * Boots singleton state for the gateway engine: ChainClient (operator wallet),
 * Bee + PssTransport, postage batch, ECIES cipher with operator PSS keypair,
 * ModelDiscovery cache, and the in-memory `pending` / `failureTimers` /
 * `jobMeta` maps that `handleChat` resolves against.
 *
 * Called once at startup from `src/api.ts`. The PSS subscription is started
 * here so `job_ack` / `job_deliver` envelopes flow into `pending` / DB rows.
 */
import { Bee } from '@ethersphere/bee-js';
import { keccak256, toBytes, type Hex } from 'viem';
import { makeChain, type ChainClient } from '../t4t/lib/chain';
import { discoverUsableBatchId, downloadChunk, PssTransport } from '../t4t/lib/swarm';
import { ensureManagedStamp, topUpIfBelow, type ManagedStamp } from '../t4t/lib/stamps';
import { clientTopic } from '../t4t/lib/envelope';
import { EciesCipher, jsonDecrypt } from '../t4t/lib/crypto';
import { loadOrCreatePssKey } from '../t4t/lib/keys';
import { ModelDiscovery } from '../t4t/modes/gateway/models';
import type {
  JobAckBody,
  JobDeliverBody,
  OpenAIChatResponse,
  ResponsePayload,
} from '../t4t/lib/types';
import { cancelJob, timeoutJob } from '../chain/operatorChain';
import { env } from '../env';
import { logger } from '../logger';
import { prisma } from '../db';
import { releaseReservation } from '../accounts/ledger';
import { ACK_WINDOW_SECONDS } from '../t4t/lib/chain';

const FAILURE_GRACE_SECONDS = 5;

export interface PendingSlot {
  resolve: (r: OpenAIChatResponse) => void;
  reject: (e: unknown) => void;
}

export interface FailureSlot {
  onChainJobId: Hex;
  deliveryDeadline: number;
  cancelTimer?: ReturnType<typeof setTimeout>;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

export interface JobMetaSlot {
  userId: string;
  gatewayJobId: string;
  estimateMaxXbzzWei: bigint;
  provider: string;
  modelId: string;
}

export interface GatewayContext {
  bee: Bee;
  chain: ChainClient;
  postageBatchId: string;
  cipher: EciesCipher;
  pss: PssTransport;
  pssPubKeyX: Hex;
  selfOverlay: Hex;
  discovery: ModelDiscovery;
  pending: Map<Hex, PendingSlot>;
  failureTimers: Map<Hex, FailureSlot>;
  jobMeta: Map<Hex, JobMetaSlot>;
  clearFailureTimers: (routing: Hex) => void;
  rejectAndCleanup: (routing: Hex, err: Error) => void;
  scheduleAckTimeout: (routing: Hex, slot: FailureSlot) => void;
}

let bootPromise: Promise<GatewayContext> | null = null;

export function getGatewayContext(): Promise<GatewayContext> {
  if (!bootPromise) bootPromise = bootGatewayContext();
  return bootPromise;
}

async function bootGatewayContext(): Promise<GatewayContext> {
  const bee = new Bee(env.BEE_API_URL);

  // Resolve the operator's postage batch (env-pinned, managed, or discovered).
  const postageBatchId = await resolvePostageBatch(bee);

  const chain = makeChain({
    rpcUrl: env.GNOSIS_RPC_URL,
    privateKey: env.OPERATOR_PRIVATE_KEY as Hex,
    registry: env.REGISTRY_ADDRESS as Hex,
    escrow: env.ESCROW_ADDRESS as Hex,
    xbzz: env.XBZZ_ADDRESS as Hex,
  });

  // Operator PSS keypair — persisted to disk so every api replica shares the
  // same identity. Without this, each replica generates a fresh keypair at
  // boot and providers encrypt their PSS replies to a key only one replica
  // can decrypt, so most chat completions hang.
  const pssKeys = loadOrCreatePssKey(env.PSS_KEY_PATH);

  const cipher = new EciesCipher(pssKeys.privateKey);
  // Block until Bee returns a non-zero overlay; without this, a replica that
  // races Bee's boot persists `selfOverlay = 0x00…00` in its gateway context
  // and providers send PSS replies into the void.
  const selfOverlay = await resolveSelfOverlay(bee);
  const pss = new PssTransport({ bee, postageBatchId, logger, selfAddress: chain.address });

  const discovery = new ModelDiscovery({
    chain,
    minProvidersPerModel: 1,
    cacheTtlSeconds: 30,
  });

  const pending = new Map<Hex, PendingSlot>();
  const failureTimers = new Map<Hex, FailureSlot>();
  const jobMeta = new Map<Hex, JobMetaSlot>();

  function clearFailureTimers(routing: Hex): void {
    const slot = failureTimers.get(routing);
    if (!slot) return;
    if (slot.cancelTimer) clearTimeout(slot.cancelTimer);
    if (slot.timeoutTimer) clearTimeout(slot.timeoutTimer);
    failureTimers.delete(routing);
  }

  function rejectAndCleanup(routing: Hex, err: Error): void {
    pending.get(routing)?.reject(err);
    pending.delete(routing);
    jobMeta.delete(routing);
    clearFailureTimers(routing);
  }

  async function onAckTimeout(routing: Hex): Promise<void> {
    const slot = failureTimers.get(routing);
    const meta = jobMeta.get(routing);
    if (!slot || !meta) return;
    try {
      const tx = await cancelJob(chain, slot.onChainJobId);
      logger.warn({ tx, routing, onChainJobId: slot.onChainJobId }, 'no ACK — cancelled on-chain');
      await markGatewayJob(meta.gatewayJobId, 'cancelled', 'no PSS ack within ACK_WINDOW');
      await releaseReservation(meta.userId, meta.gatewayJobId, meta.estimateMaxXbzzWei);
      rejectAndCleanup(routing, new Error('provider failed to ACK within window'));
    } catch (err) {
      logger.warn({ err, routing }, 'cancelJob failed — provider likely acked mid-flight');
    }
  }

  async function onDeliveryTimeout(routing: Hex): Promise<void> {
    const slot = failureTimers.get(routing);
    const meta = jobMeta.get(routing);
    if (!slot || !meta) return;
    try {
      const tx = await timeoutJob(chain, slot.onChainJobId);
      logger.warn({ tx, routing, onChainJobId: slot.onChainJobId }, 'delivery missed — timeoutJob');
      await markGatewayJob(meta.gatewayJobId, 'timed_out', 'no PSS delivery before deadline');
      await releaseReservation(meta.userId, meta.gatewayJobId, meta.estimateMaxXbzzWei);
      rejectAndCleanup(routing, new Error('provider failed to deliver before deadline'));
      return;
    } catch (err) {
      logger.warn({ err, routing }, 'timeoutJob reverted — falling back to cancelJob');
    }
    try {
      const tx = await cancelJob(chain, slot.onChainJobId);
      logger.warn({ tx, routing, onChainJobId: slot.onChainJobId }, 'cancelJob fallback applied');
      await markGatewayJob(meta.gatewayJobId, 'cancelled', 'no PSS delivery; cancelJob fallback');
      await releaseReservation(meta.userId, meta.gatewayJobId, meta.estimateMaxXbzzWei);
      rejectAndCleanup(routing, new Error('provider failed to deliver before deadline'));
    } catch (err) {
      logger.error({ err, routing }, 'both timeoutJob and cancelJob failed — job stuck in escrow');
      rejectAndCleanup(routing, new Error('delivery deadline missed; settlement failed'));
    }
  }

  function scheduleAckTimeout(routing: Hex, slot: FailureSlot): void {
    slot.cancelTimer = setTimeout(() => {
      onAckTimeout(routing).catch((err) =>
        logger.error({ err, routing }, 'onAckTimeout threw'),
      );
    }, (ACK_WINDOW_SECONDS + FAILURE_GRACE_SECONDS) * 1000);
  }

  // Subscribe to the operator's client topic — ALL tenants' jobs come back
  // here (because all jobs go on-chain as the operator wallet).
  pss.subscribe({
    topic: clientTopic(chain.address),
    onEnvelope: async (envelope) => {
      if (envelope.type === 'job_ack') {
        const body = envelope.body as JobAckBody;
        logger.info({ jobId: body.jobId, eta: body.estimatedCompletion }, 'ack received');
        const slot = failureTimers.get(body.jobId);
        const meta = jobMeta.get(body.jobId);
        if (slot) {
          if (slot.cancelTimer) {
            clearTimeout(slot.cancelTimer);
            slot.cancelTimer = undefined;
          }
          if (!slot.timeoutTimer) {
            const msUntilTimeout = Math.max(
              0,
              (slot.deliveryDeadline + FAILURE_GRACE_SECONDS) * 1000 - Date.now(),
            );
            slot.timeoutTimer = setTimeout(() => {
              onDeliveryTimeout(body.jobId).catch((err) =>
                logger.error({ err, routing: body.jobId }, 'onDeliveryTimeout threw'),
              );
            }, msUntilTimeout);
          }
        }
        if (meta) {
          await markGatewayJob(meta.gatewayJobId, 'acked', null, { ackedAt: new Date() });
        }
      } else if (envelope.type === 'job_deliver') {
        const body = envelope.body as JobDeliverBody;
        const slot = pending.get(body.jobId);
        const meta = jobMeta.get(body.jobId);
        if (!slot) return;
        try {
          const bytes = await downloadChunk({ bee, postageBatchId, logger }, body.responseHash);
          const payload = await jsonDecrypt<ResponsePayload>(cipher, bytes);
          if (meta) {
            await markGatewayJob(meta.gatewayJobId, 'delivered', null, {
              deliveredAt: new Date(),
              responseHash: body.responseHash,
              promptTokens: payload.openaiResponse.usage?.prompt_tokens ?? null,
              completionTokens: payload.openaiResponse.usage?.completion_tokens ?? null,
            });
          }
          slot.resolve(payload.openaiResponse);
        } catch (err) {
          slot.reject(err);
        } finally {
          pending.delete(body.jobId);
          jobMeta.delete(body.jobId);
          clearFailureTimers(body.jobId);
        }
      }
    },
  });

  logger.info(
    {
      operator: chain.address,
      postageBatchId,
      pssPubKey: pssKeys.publicKeyX,
      selfOverlay,
    },
    'gateway context booted',
  );

  return {
    bee,
    chain,
    postageBatchId,
    cipher,
    pss,
    pssPubKeyX: pssKeys.publicKeyX,
    selfOverlay,
    discovery,
    pending,
    failureTimers,
    jobMeta,
    clearFailureTimers,
    rejectAndCleanup,
    scheduleAckTimeout,
  };
}

async function resolvePostageBatch(bee: Bee): Promise<string> {
  if (env.BEE_POSTAGE_BATCH_ID) return env.BEE_POSTAGE_BATCH_ID;
  if (env.BEE_STAMP_MANAGE) {
    const managed: ManagedStamp = await ensureManagedStamp({
      bee,
      logger,
      opts: {
        depth: 22,
        ttlDays: env.BEE_STAMP_TTL_DAYS,
        minTtlDays: 7,
        label: env.BEE_STAMP_LABEL,
        dryRun: false,
      },
    });
    // Re-check every 5 min (matches t4t-container's gateway tick).
    setInterval(() => {
      topUpIfBelow({
        bee,
        logger,
        batchId: managed.batchID,
        ttlDays: env.BEE_STAMP_TTL_DAYS,
        minTtlDays: 7,
        maxUtilization: 0.7,
        maxDepth: 28,
        dryRun: false,
      }).catch((err) => logger.warn({ err }, 'stamp tick failed'));
    }, 300_000).unref();
    return managed.batchID;
  }
  const discovered = await discoverUsableBatchId(bee);
  if (!discovered) {
    throw new Error(
      'No usable postage batch on the Bee node. Set BEE_POSTAGE_BATCH_ID or BEE_STAMP_MANAGE=true.',
    );
  }
  return discovered;
}

async function resolveSelfOverlay(bee: Bee): Promise<Hex> {
  const zero = '0x' + '00'.repeat(32);
  for (let attempt = 0; attempt < 60; attempt++) {
    const info = await bee.getNodeAddresses().catch(() => null);
    const overlay = info?.overlay?.toString();
    if (overlay && overlay.replace(/^0x/, '') !== '00'.repeat(32)) {
      return ('0x' + overlay.replace(/^0x/, '')) as Hex;
    }
    logger.warn({ attempt }, 'bee.getNodeAddresses returned no overlay yet — retrying in 5s');
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('bee did not return a non-zero overlay after 60 attempts — refusing to boot with a zeroed selfOverlay');
}

/** Update a GatewayJob row. Direct prisma write (not model.gatewayJob.update)
 *  because we don't need fan-out for status transitions in v1. */
async function markGatewayJob(
  id: string,
  status:
    | 'posted'
    | 'acked'
    | 'delivered'
    | 'claimed'
    | 'cancelled'
    | 'timed_out'
    | 'failed',
  errorMessage: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await prisma.gatewayJob
    .update({
      where: { id },
      data: {
        status,
        errorMessage: errorMessage ?? undefined,
        ...extra,
      },
    })
    .catch((err) => logger.warn({ err: err.message, id, status }, 'gatewayJob update failed'));
}

/** Util: derive the routing id (mirrors handleChat). Exposed for tests. */
export function deriveRoutingId(requestHashHex: string): Hex {
  return keccak256(toBytes('0x' + requestHashHex.replace(/^0x/, '')));
}
