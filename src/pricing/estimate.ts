import type { ModelOffering } from '../t4t/lib/types';
import { env } from '../env';

const BPS_DIVISOR = 10_000n;
const TOKENS_PER_MILLION = 1_000_000n;

// Conservative ceiling matches the t4t/container homelab gateway. We assume
// prompt and completion could each be `max_tokens + headroom` and budget both
// sides at the model's full split rate. The provider always claims the actual
// (smaller) amount; the JobEscrow contract refunds the remainder to the client.
//
// Why so generous: providers may apply chat templates that inflate the prompt
// token count well beyond the user-visible messages, and the on-chain
// `maxContextTokens` is sometimes unset (== 0) — in which case the previous
// per-actual-input formula posted a too-low maxPayment and the provider's
// claimJob reverted with PaymentTooHigh.
const DEFAULT_MAX_TOKENS = 1024n;
// Headroom is added to BOTH input and output budgets to cover usage drift
// (chat templates, system prompts the user can't see, etc.). The
// concurrency cap on JobEscrow.postJob is
//   needed = (openJobs + 1) * SLASH_MULT_TIMEOUT * maxPayment <= stake
// so headroom directly multiplies how much stake the provider must lock per
// in-flight job. 50k tokens is generous enough that real usage never exceeds
// it but small enough that 20-ish concurrent jobs fit in a 70-xBZZ stake.
const HEADROOM_TOKENS = 50_000n;

export interface ChatRequest {
  model: string;
  max_tokens?: number;
  messages?: Array<{ content: string }>;
}

/**
 * Rough upper-bound xBZZ cost for a single chat completion. Mirrors the
 * `maxPayment` semantics on JobEscrow.postJob.
 *
 * Returns `{ raw, withMarkup }` so the caller can:
 *   - post the *raw* amount on-chain as `maxPayment` (markup is operator
 *     revenue, not paid to providers)
 *   - reserve the *with-markup* amount off-chain
 */
export function estimateMaxXbzz(
  req: ChatRequest,
  offering: Pick<ModelOffering, 'inputPricePerMillionTokens' | 'outputPricePerMillionTokens' | 'maxContextTokens'>,
): { rawWei: bigint; withMarkupWei: bigint } {
  const maxTokens = BigInt(req.max_tokens ?? DEFAULT_MAX_TOKENS);
  const budget = maxTokens + HEADROOM_TOKENS;
  const inPay = BigInt(offering.inputPricePerMillionTokens) * budget;
  const outPay = BigInt(offering.outputPricePerMillionTokens) * budget;
  const rawWei = (inPay + outPay) / TOKENS_PER_MILLION;
  const withMarkupWei = (rawWei * (BPS_DIVISOR + BigInt(env.MARKUP_BPS))) / BPS_DIVISOR;
  return { rawWei, withMarkupWei };
}

/** Apply the same markup function used at reservation time to a settled cost. */
export function applyMarkup(rawWei: bigint): bigint {
  return (rawWei * (BPS_DIVISOR + BigInt(env.MARKUP_BPS))) / BPS_DIVISOR;
}
