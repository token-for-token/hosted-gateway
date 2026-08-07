/**
 * Pure-function regressions for the wei/query coercion helpers. No Postgres,
 * Redis, Bee or RPC — run with `bun run test:unit`.
 */
import { describe, expect, it } from 'bun:test';
import { Prisma } from '@prisma/client';
import { weiString, weiToBigInt } from '../../src/lib/decimal';
import { parseLimit } from '../../src/lib/query';

// `src/pricing/estimate` pulls in the zod-validated env module, which exits the
// process when required vars are missing. Fill in the minimum before importing.
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test';
process.env.JWT_SECRET_KEY ??= 'test-secret-at-least-16-chars';
process.env.OPERATOR_PRIVATE_KEY ??= '0x' + '11'.repeat(32);
process.env.GNOSIS_RPC_URL ??= 'http://localhost:8545';
process.env.REGISTRY_ADDRESS ??= '0x' + '22'.repeat(20);
process.env.ESCROW_ADDRESS ??= '0x' + '33'.repeat(20);
process.env.XBZZ_ADDRESS ??= '0x' + '44'.repeat(20);
process.env.BEE_API_URL ??= 'http://localhost:1633';
process.env.MARKUP_BPS ??= '2000';
const { estimateMaxXbzz } = await import('../../src/pricing/estimate');

const OFFERING = {
  inputPricePerMillionTokens: 10n ** 18n,
  outputPricePerMillionTokens: 2n * 10n ** 18n,
  maxContextTokens: 0n,
};

describe('wei rendering', () => {
  it('keeps large balances in plain notation', () => {
    // decimal.js' toString() flips to exponential at 1e21 — i.e. at 1000 xBZZ,
    // which is an ordinary balance. "1e+21" is not a valid BigInt literal.
    const thousandXbzz = new Prisma.Decimal('1000000000000000000000');
    expect(thousandXbzz.toString()).toBe('1e+21'); // the trap being guarded
    expect(weiString(thousandXbzz)).toBe('1000000000000000000000');
    expect(weiToBigInt(thousandXbzz)).toBe(1000000000000000000000n);
  });

  it('round-trips a full uint256', () => {
    const max = (2n ** 256n - 1n).toString();
    expect(weiToBigInt(new Prisma.Decimal(max))).toBe(2n ** 256n - 1n);
  });

  it('handles negative deltas and zero', () => {
    expect(weiString(new Prisma.Decimal('-5000000000000000000000'))).toBe('-5000000000000000000000');
    expect(weiString(new Prisma.Decimal(0))).toBe('0');
  });
});

describe('parseLimit', () => {
  it('clamps to the allowed range', () => {
    expect(parseLimit('10')).toBe(10);
    expect(parseLimit('1000')).toBe(200);
    expect(parseLimit('-5')).toBe(1);
    expect(parseLimit('0')).toBe(1);
  });

  it('falls back instead of handing Prisma a NaN take', () => {
    expect(parseLimit('abc')).toBe(50);
    expect(parseLimit(undefined)).toBe(50);
    expect(parseLimit('')).toBe(50); // Number('') is 0, but empty means "unset"
  });

  it('truncates fractional input', () => {
    expect(parseLimit('12.9')).toBe(12);
  });
});

describe('estimateMaxXbzz', () => {
  it('never returns a negative reservation', () => {
    for (const max_tokens of [-1000, -1, 0]) {
      const { rawWei, withMarkupWei } = estimateMaxXbzz({ model: 'm', max_tokens }, OFFERING);
      expect(rawWei > 0n).toBe(true);
      expect(withMarkupWei >= rawWei).toBe(true);
    }
  });

  it('does not throw on a fractional max_tokens', () => {
    const { rawWei } = estimateMaxXbzz({ model: 'm', max_tokens: 100.5 }, OFFERING);
    const { rawWei: dflt } = estimateMaxXbzz({ model: 'm' }, OFFERING);
    expect(rawWei).toBe(dflt);
  });

  it('scales with max_tokens', () => {
    const small = estimateMaxXbzz({ model: 'm', max_tokens: 1 }, OFFERING).rawWei;
    const large = estimateMaxXbzz({ model: 'm', max_tokens: 100_000 }, OFFERING).rawWei;
    expect(large > small).toBe(true);
  });

  it('applies the markup on top of the on-chain amount', () => {
    const { rawWei, withMarkupWei } = estimateMaxXbzz({ model: 'm', max_tokens: 1024 }, OFFERING);
    expect(withMarkupWei).toBe((rawWei * 12_000n) / 10_000n);
  });
});
