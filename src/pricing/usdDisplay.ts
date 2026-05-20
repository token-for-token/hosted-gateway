// USD conversion helpers — DASHBOARD COSMETICS ONLY. The billing path never
// touches USD; see plan section "Decisions locked in".
import { getBzzUsd } from '../t4t/lib/bzz-price';
import { logger } from '../logger';

const WEI_PER_XBZZ = 10n ** 18n;

/**
 * Returns a USD-cents equivalent of an xBZZ-wei amount, or `null` if the price
 * oracle isn't reachable.
 */
export async function getUsdEquivalent(wei: bigint): Promise<number | null> {
  try {
    const usdPerXbzz = await getBzzUsd(logger);
    if (!usdPerXbzz || usdPerXbzz <= 0) return null;
    const xbzz = Number(wei) / Number(WEI_PER_XBZZ); // safe loss for display
    return Math.round(xbzz * usdPerXbzz * 100);
  } catch {
    return null;
  }
}
