/**
 * Refactor of t4t/container/src/modes/gateway/index.ts `handleChat`. The only
 * functional change is that the persisted GatewayJob row carries `userId` and
 * `estimatedMaxXbzzWei` so the claim watcher can settle the off-chain ledger
 * against the right tenant. Provider selection, on-chain interaction, PSS
 * notify, response wait — all unchanged.
 */
import { keccak256, toBytes, toHex, type Hex } from 'viem';
import { jsonEncrypt } from '../t4t/lib/crypto';
import { uploadChunk } from '../t4t/lib/swarm';
import { signEnvelope, providerTopic } from '../t4t/lib/envelope';
import { selectProvider } from '../t4t/modes/gateway/selector';
import type {
  JobNotifyBody,
  OpenAIChatRequest,
  OpenAIChatResponse,
  RequestPayload,
} from '../t4t/lib/types';
import { ACK_WINDOW_SECONDS } from '../t4t/lib/chain';
import { ensureAllowance, postJob } from '../chain/operatorChain';
import { prisma } from '../db';
import { env } from '../env';
import { logger } from '../logger';
import { estimateMaxXbzz, type ChatRequest } from '../pricing/estimate';
import { releaseReservation, reserveXbzz } from '../accounts/ledger';
import type { GatewayContext, FailureSlot } from './context';

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_DEADLINE_SECONDS = 300;

export interface HandleChatArgs {
  ctx: GatewayContext;
  userId: string;
  req: OpenAIChatRequest;
}

export interface HandleChatResult {
  gatewayJobId: string;
  response: OpenAIChatResponse;
}

export async function handleChat(args: HandleChatArgs): Promise<HandleChatResult> {
  const { ctx, userId, req } = args;

  // 1) Select provider (stateless registry scan against the operator's chain
  //    client; selector reads from chain on each call).
  const target = await selectProvider(ctx.chain, 'top_rep_cheapest', {
    modelId: req.model,
  });
  if (!target) throw new Error(`no provider matches model=${req.model}`);

  // 2) Estimate cost — raw (posted on-chain as maxPayment) vs with-markup
  //    (reserved off-chain; the operator keeps the markup).
  const { rawWei, withMarkupWei } = estimateMaxXbzz(req as ChatRequest, target.offering);

  // 3) Reserve off-chain BEFORE doing any chain work. If this throws (402), no
  //    on-chain side effect happened — fail-closed.
  await reserveXbzz(userId, withMarkupWei);

  // 4) Allowance + on-chain postJob. Both serialized by `withLock('chain:operator')`.
  let releasedReservation = false;
  let gatewayJobId: string | null = null;
  try {
    await ensureAllowance(ctx.chain, ctx.chain.escrow, rawWei);

    const reqPayload: RequestPayload = {
      v: PROTOCOL_VERSION,
      jobId: toHex(crypto.getRandomValues(new Uint8Array(32))),
      client: ctx.chain.address,
      modelId: req.model,
      openaiRequest: req,
      clientPssPubKey: ctx.pssPubKeyX,
      ts: Math.floor(Date.now() / 1000),
    };
    const encrypted = await jsonEncrypt(ctx.cipher, target.provider.pssPublicKey, reqPayload);
    const requestHash = await uploadChunk(
      { bee: ctx.bee, postageBatchId: ctx.postageBatchId, logger },
      encrypted,
    );

    const deliveryDeadline = Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS;
    const { txHash, jobId: onChainJobId } = await postJob(ctx.chain, {
      provider: target.provider.owner,
      requestHash: ('0x' + requestHash) as Hex,
      modelId: req.model,
      maxPayment: rawWei,
      deliveryDeadline,
    });
    logger.info({ txHash, onChainJobId, provider: target.provider.owner, userId }, 'job posted on-chain');

    const jobIdRouting = keccak256(toBytes('0x' + requestHash));

    // Persist the GatewayJob row (tenant attribution lives here).
    const created = await prisma.gatewayJob.create({
      data: {
        routingId: jobIdRouting,
        onChainJobId,
        requestHash,
        provider: target.provider.owner,
        modelId: req.model,
        estimatedMaxXbzzWei: withMarkupWei.toString(),
        status: 'posted',
        postedAt: new Date(),
        deliveryDeadline: new Date(deliveryDeadline * 1000),
        userId,
      },
    });
    gatewayJobId = created.id;

    ctx.jobMeta.set(jobIdRouting, {
      userId,
      gatewayJobId: created.id,
      estimateMaxXbzzWei: withMarkupWei,
      provider: target.provider.owner,
      modelId: req.model,
    });

    // 5) PSS-notify the provider out-of-band (chain is the truth; PSS is
    //    only the wake-up).
    const settled = new Promise<OpenAIChatResponse>((resolve, reject) => {
      ctx.pending.set(jobIdRouting, { resolve, reject });
    });

    const slot: FailureSlot = { onChainJobId, deliveryDeadline };
    ctx.failureTimers.set(jobIdRouting, slot);
    ctx.scheduleAckTimeout(jobIdRouting, slot);

    const envelope = await signEnvelope<JobNotifyBody>(
      {
        from: ctx.chain.address,
        to: target.provider.owner,
        type: 'job_notify',
        body: {
          jobId: jobIdRouting,
          requestHash,
          modelId: req.model,
          maxPayment: rawWei.toString(),
          deliveryDeadline,
          clientPssPubKey: ctx.pssPubKeyX,
          clientSwarmOverlay: ctx.selfOverlay,
          clientReplyUrl: env.PUBLIC_API_URL ? `${env.PUBLIC_API_URL.replace(/\/$/, '')}/pss/inbox` : undefined,
        },
      },
      (msg) => ctx.chain.wallet.signMessage({ account: ctx.chain.wallet.account!, message: msg }),
    );
    try {
      await ctx.pss.send({
        topic: providerTopic(target.provider.owner),
        recipientOverlay: target.provider.swarmOverlay,
        recipientPssKey: target.provider.pssPublicKey,
        envelope,
      });
    } catch (err) {
      // Orphan cleanup: drop the pending state synchronously so the ACK timer
      // is a no-op when it fires, and release the reservation.
      ctx.pending.delete(jobIdRouting);
      ctx.jobMeta.delete(jobIdRouting);
      ctx.clearFailureTimers(jobIdRouting);
      await releaseReservation(userId, created.id, withMarkupWei);
      releasedReservation = true;
      throw err;
    }

    const response = await settled;
    return { gatewayJobId: created.id, response };
  } catch (err) {
    // On any failure before / during dispatch, release the reservation. Skip
    // if the orphan-cleanup branch above already did so.
    if (!releasedReservation && gatewayJobId) {
      await releaseReservation(userId, gatewayJobId, withMarkupWei).catch((e) =>
        logger.warn({ err: e.message, gatewayJobId }, 'release on failure failed'),
      );
    } else if (!releasedReservation) {
      // No GatewayJob row created yet — manually decrement reserved.
      await prisma.account
        .update({
          where: { userId },
          data: { reservedXbzzWei: { decrement: withMarkupWei.toString() } },
        })
        .catch((e) => logger.warn({ err: e.message, userId }, 'reserved decrement on failure failed'));
    }
    throw err;
  }
}
