/**
 * Query-string coercion helpers. Everything in `query` is a string (or absent)
 * and is attacker-controlled, so it needs clamping before it reaches Prisma —
 * `take: NaN` from `?limit=abc` fails the query with a 500 rather than the 400
 * the caller deserves, and a negative `take` silently paginates backwards.
 */
export function parseLimit(raw: unknown, fallback = 50, max = 200): number {
  if (raw === undefined || raw === null) return fallback;
  // `?limit=` parses as 0, which would clamp to 1 rather than mean "unset".
  if (typeof raw === 'string' && raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
}
