import type { Prisma } from '@prisma/client';

/**
 * Rendering helpers for the `Decimal(78, 0)` wei columns.
 *
 * `Prisma.Decimal` is decimal.js under the hood, and decimal.js' `toString()`
 * switches to exponential notation once the exponent reaches 21 — so a balance
 * of 1000 xBZZ stringifies as `"1e+21"`, not `"1000000000000000000000"`. That
 * string is not a valid BigInt literal (`BigInt("1e+21")` throws) and it is not
 * something an API client can parse as an integer either. `toFixed()` always
 * emits plain digits, which is what wei values need everywhere.
 */

/** Plain-digit decimal string for a wei column — never exponential notation. */
export function weiString(value: Prisma.Decimal): string {
  return value.toFixed();
}

/** Same, as a BigInt. */
export function weiToBigInt(value: Prisma.Decimal): bigint {
  return BigInt(value.toFixed());
}
