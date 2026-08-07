-- AlterTable
ALTER TABLE "GatewayJob" ADD COLUMN     "reservationReleasedAt" TIMESTAMP(3);

-- Data repair: before this migration, `releaseReservation` bailed out whenever
-- the GatewayJob row was already in a terminal status — and both failure paths
-- in `gateway/context.ts` marked the row `cancelled` / `timed_out` *before*
-- calling it. So every job that failed to ACK or to deliver left its
-- `Account.reservedXbzzWei` permanently inflated, shrinking the tenant's
-- available balance for good. Give that stuck xBZZ back, flooring at 0 so a
-- partially-repaired database can never go negative.
UPDATE "Account" a
SET "reservedXbzzWei" = GREATEST(a."reservedXbzzWei" - leaked.total, 0)
FROM (
  SELECT j."userId" AS "userId", SUM(j."estimatedMaxXbzzWei") AS total
  FROM "GatewayJob" j
  WHERE j."status" IN ('cancelled', 'timed_out')
    AND j."reservationReleasedAt" IS NULL
  GROUP BY j."userId"
) AS leaked
WHERE a."userId" = leaked."userId";

-- Backfill the marker for every job whose reservation is no longer outstanding
-- (either repaired above, or already settled by `settleXbzz` on JobClaimed) so
-- a late JobClaimed event can't decrement the same reservation twice.
UPDATE "GatewayJob"
SET "reservationReleasedAt" = COALESCE("claimedAt", "updatedAt")
WHERE "status" IN ('claimed', 'cancelled', 'timed_out', 'failed');
