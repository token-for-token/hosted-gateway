import Elysia from 'elysia';
import { prisma } from '../db';
import { jwtGuard } from '../auth/jwt';
import { getUsdEquivalent } from '../pricing/usdDisplay';
import { weiString, weiToBigInt } from '../lib/decimal';
import { parseLimit } from '../lib/query';

export const accountsRoutes = new Elysia({ prefix: '/accounts' })
  .use(jwtGuard)
  .get('/me', async ({ user }) => {
    const account = await prisma.account.findUniqueOrThrow({
      where: { userId: user.userId },
      select: {
        id: true,
        status: true,
        balanceXbzzWei: true,
        reservedXbzzWei: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const balanceWei = weiToBigInt(account.balanceXbzzWei);
    const reservedWei = weiToBigInt(account.reservedXbzzWei);
    const available = balanceWei - reservedWei;

    const balanceUsd = await getUsdEquivalent(balanceWei).catch(() => null);
    const availableUsd = await getUsdEquivalent(available).catch(() => null);

    return {
      id: account.id,
      status: account.status,
      balanceXbzzWei: weiString(account.balanceXbzzWei),
      reservedXbzzWei: weiString(account.reservedXbzzWei),
      availableXbzzWei: available.toString(),
      balanceUsd,        // cosmetic; null if oracle unavailable
      availableUsd,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  })
  .get('/me/ledger', async ({ user, query }) => {
    const limit = parseLimit(query.limit);
    const account = await prisma.account.findUniqueOrThrow({
      where: { userId: user.userId },
      select: { id: true },
    });
    const entries = await prisma.ledgerEntry.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        kind: true,
        deltaXbzzWei: true,
        createdAt: true,
        gatewayJobId: true,
        topupId: true,
        note: true,
      },
    });
    return entries.map((e) => ({ ...e, deltaXbzzWei: weiString(e.deltaXbzzWei) }));
  });
