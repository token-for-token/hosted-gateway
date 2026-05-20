/**
 * Polls the operator wallet's xBZZ + xDAI balances and alerts on low headroom.
 * The operator wallet backs ALL virtual xBZZ on user accounts; if its xBZZ
 * float runs dry, every chat completion fails at `postJob`. xDAI runs gas.
 *
 * v1 just logs at WARN; Phase 2 wires a Slack / PagerDuty webhook.
 */
import { erc20Abi } from 'viem';
import { logger } from '../logger';
import { getGatewayContext } from '../gateway/context';

const POLL_INTERVAL_MS = 5 * 60_000;
const LOW_XBZZ_THRESHOLD_WEI = 100n * 10n ** 18n; // 100 xBZZ
const LOW_XDAI_THRESHOLD_WEI = 1n * 10n ** 17n;  // 0.1 xDAI

export function startBalanceMonitor(): void {
  setInterval(() => {
    poll().catch((err) => logger.warn({ err: err.message }, 'balance monitor tick failed'));
  }, POLL_INTERVAL_MS).unref();
  // Fire once on startup so the first reading is in the logs immediately.
  poll().catch((err) => logger.warn({ err: err.message }, 'initial balance monitor tick failed'));
  logger.info('balance monitor started');
}

async function poll(): Promise<void> {
  const ctx = await getGatewayContext();
  const xbzz = await ctx.chain.pub.readContract({
    address: ctx.chain.xbzz,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [ctx.chain.address],
  });
  const xdai = await ctx.chain.pub.getBalance({ address: ctx.chain.address });

  logger.info(
    {
      operator: ctx.chain.address,
      xbzzWei: (xbzz as bigint).toString(),
      xdaiWei: xdai.toString(),
    },
    'operator wallet balances',
  );

  if ((xbzz as bigint) < LOW_XBZZ_THRESHOLD_WEI) {
    logger.warn(
      { xbzzWei: (xbzz as bigint).toString(), thresholdWei: LOW_XBZZ_THRESHOLD_WEI.toString() },
      'operator xBZZ balance is low — refill the float',
    );
  }
  if (xdai < LOW_XDAI_THRESHOLD_WEI) {
    logger.warn(
      { xdaiWei: xdai.toString(), thresholdWei: LOW_XDAI_THRESHOLD_WEI.toString() },
      'operator xDAI balance is low — refill for gas',
    );
  }
}
