import type { ModelOffering } from '../t4t/lib/types';
import { env } from '../env';

const BPS_DIVISOR = 10_000n;
const TOKENS_PER_MILLION = 1_000_000n;

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
  const maxInputTokens = estimateInputTokens(req);
  const maxOutputTokens = BigInt(req.max_tokens ?? Number(offering.maxContextTokens));

  const inputCost = (BigInt(maxInputTokens) * BigInt(offering.inputPricePerMillionTokens)) / TOKENS_PER_MILLION;
  const outputCost = (maxOutputTokens * BigInt(offering.outputPricePerMillionTokens)) / TOKENS_PER_MILLION;
  const rawWei = inputCost + outputCost;
  const withMarkupWei = (rawWei * (BPS_DIVISOR + BigInt(env.MARKUP_BPS))) / BPS_DIVISOR;
  return { rawWei, withMarkupWei };
}

/**
 * Approximate input-token count from messages. Uses a 4-char-per-token
 * heuristic — fine for an upper-bound estimate; the actual cost is recorded
 * later from the JobClaimed event.
 */
function estimateInputTokens(req: ChatRequest): number {
  const totalChars = (req.messages ?? []).reduce((acc, m) => acc + (m.content?.length ?? 0), 0);
  return Math.ceil(totalChars / 4) + 16; // +16 for system / role overhead
}

/** Apply the same markup function used at reservation time to a settled cost. */
export function applyMarkup(rawWei: bigint): bigint {
  return (rawWei * (BPS_DIVISOR + BigInt(env.MARKUP_BPS))) / BPS_DIVISOR;
}
