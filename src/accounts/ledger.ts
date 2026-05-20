import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { logger } from '../logger';

/**
 * Off-chain xBZZ ledger for tenant accounts. All deltas live in `LedgerEntry`
 * (append-only, idempotent by `idempotencyKey`); `Account.balanceXbzzWei` and
 * `Account.reservedXbzzWei` are denormalized running totals updated in the
 * same transaction.
 *
 * Reservations are tracked as `Account.reservedXbzzWei` (a field on the
 * account), not as ledger rows — the ledger means "money moved" not "money
 * locked". On `JobClaimed` the reservation is released AND a `settle` ledger
 * row debits the actual cost.
 */

export class InsufficientBalanceError extends Error {
  constructor() {
    super('Insufficient xBZZ credit');
  }
}

export async function creditWelcomeGrant(accountId: string): Promise<void> {
  const key = `welcome:${accountId}`;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.ledgerEntry.create({
        data: {
          accountId,
          kind: 'welcomeGrant',
          deltaXbzzWei: new Prisma.Decimal(env.WELCOME_XBZZ_WEI),
          idempotencyKey: key,
        },
      });
      await tx.account.update({
        where: { id: accountId },
        data: { balanceXbzzWei: { increment: new Prisma.Decimal(env.WELCOME_XBZZ_WEI) } },
      });
    });
    logger.info({ accountId, xbzz: env.WELCOME_XBZZ_WEI }, 'welcome grant credited');
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Unique constraint violation on idempotencyKey — already credited.
      logger.debug({ accountId }, 'welcome grant already credited (idempotent)');
      return;
    }
    throw err;
  }
}

/**
 * Reserve xBZZ for an in-flight chat completion. Atomic with `SELECT FOR UPDATE`
 * to prevent two concurrent requests from over-spending the same user's balance.
 * Throws `InsufficientBalanceError` if available < amount.
 */
export async function reserveXbzz(userId: string, amountWei: bigint): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Postgres `SELECT FOR UPDATE` via raw SQL — Prisma's `update` is also
    // atomic but doesn't expose the row-level lock semantics we want.
    const rows = await tx.$queryRaw<
      { id: string; balance_xbzz_wei: string; reserved_xbzz_wei: string; status: string }[]
    >`SELECT id, "balanceXbzzWei" AS balance_xbzz_wei, "reservedXbzzWei" AS reserved_xbzz_wei, status::text AS status
        FROM "Account" WHERE "userId" = ${userId} FOR UPDATE`;
    const acc = rows[0];
    if (!acc) throw new Error('Account not found');
    if (acc.status !== 'active') throw new Error(`Account is ${acc.status}`);

    const balance = BigInt(acc.balance_xbzz_wei);
    const reserved = BigInt(acc.reserved_xbzz_wei);
    if (balance - reserved < amountWei) {
      throw new InsufficientBalanceError();
    }
    await tx.account.update({
      where: { id: acc.id },
      data: { reservedXbzzWei: { increment: new Prisma.Decimal(amountWei.toString()) } },
    });
  });
}

/**
 * Settle a completed job: release the reservation and debit the actual cost.
 * Idempotent via the `settle:<gatewayJobId>` ledger key.
 */
export async function settleXbzz(
  userId: string,
  gatewayJobId: string,
  estimateXbzzWei: bigint,
  actualXbzzWei: bigint,
): Promise<void> {
  const key = `settle:${gatewayJobId}`;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.ledgerEntry.create({
        data: {
          accountId: (await tx.account.findUniqueOrThrow({ where: { userId }, select: { id: true } })).id,
          kind: 'settle',
          deltaXbzzWei: new Prisma.Decimal((-actualXbzzWei).toString()),
          gatewayJobId,
          idempotencyKey: key,
        },
      });
      await tx.account.update({
        where: { userId },
        data: {
          balanceXbzzWei: { decrement: new Prisma.Decimal(actualXbzzWei.toString()) },
          reservedXbzzWei: { decrement: new Prisma.Decimal(estimateXbzzWei.toString()) },
        },
      });
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.debug({ gatewayJobId }, 'settle already recorded (idempotent)');
      return;
    }
    throw err;
  }
}

/**
 * Release a reservation without debiting (job cancelled or timed out).
 * Idempotent via `release:<gatewayJobId>` — but we don't write a ledger row,
 * we only adjust `reservedXbzzWei` and rely on the GatewayJob status
 * transition to mark the release as having happened.
 */
export async function releaseReservation(
  userId: string,
  gatewayJobId: string,
  estimateXbzzWei: bigint,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const job = await tx.gatewayJob.findUniqueOrThrow({
      where: { id: gatewayJobId },
      select: { status: true },
    });
    // Only release once — `cancelled` / `timed_out` / `failed` are terminal.
    if (job.status === 'cancelled' || job.status === 'timed_out' || job.status === 'failed') {
      return;
    }
    await tx.account.update({
      where: { userId },
      data: { reservedXbzzWei: { decrement: new Prisma.Decimal(estimateXbzzWei.toString()) } },
    });
  });
}
