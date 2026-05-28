import Elysia, { t } from 'elysia';
import { getGatewayContext } from './context';
import { verifyEnvelope } from '../t4t/lib/envelope';
import type { Envelope } from '../t4t/lib/types';
import { logger } from '../logger';

/**
 * HTTPS fallback for the reverse-direction PSS path. The provider POSTs the
 * same signed envelopes (`job_ack`, `job_deliver`) it would have sent via PSS.
 * We verify the signature here — same trust check as the PSS subscription — and
 * hand off to the shared envelope handler.
 *
 * Lives outside the JWT-guarded routes because providers don't have JWTs.
 * Security model: anyone can POST, but only envelopes signed by a wallet the
 * gateway is actively waiting on (`pending.has(jobId)`) ever produce side
 * effects. Unsigned or unmatched envelopes are dropped.
 */
export const pssInboxRoutes = new Elysia().post(
  '/pss/inbox',
  async ({ body, set }) => {
    const env = body as Envelope;
    if (!(await verifyEnvelope(env))) {
      set.status = 400;
      logger.warn({ from: env.from, type: env.type }, 'pss/inbox: invalid envelope signature');
      return { error: 'invalid envelope signature' };
    }
    const ctx = await getGatewayContext();
    await ctx.onEnvelope(env);
    logger.info({ from: env.from, type: env.type }, 'pss/inbox: envelope dispatched');
    return { ok: true };
  },
  {
    body: t.Object({
      v: t.Number(),
      type: t.Union([t.Literal('job_notify'), t.Literal('job_ack'), t.Literal('job_deliver')]),
      from: t.String(),
      to: t.String(),
      ts: t.Number(),
      nonce: t.String(),
      sig: t.String(),
      body: t.Any(),
    }),
  },
);
