import Elysia, { t } from 'elysia';
import { prisma } from '../db';
import { jwtGuard } from '../auth/jwt';

export const apiKeysRoutes = new Elysia({ prefix: '/api-keys' })
  .use(jwtGuard)
  .get('/', async ({ user }) => {
    const keys = await prisma.apiKey.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastUsedAt: true,
        scopeMaxXbzzPerDay: true,
        modelAllowlist: true,
      },
    });
    // Never echo the secret value after creation.
    return keys.map((k) => ({
      ...k,
      scopeMaxXbzzPerDay: k.scopeMaxXbzzPerDay?.toString() ?? null,
    }));
  })
  .post(
    '/',
    async ({ user, body }) => {
      const created = await prisma.apiKey.create({
        data: {
          userId: user.userId,
          name: body.name ?? '',
        },
      });
      // Return the full key string ONCE; this is the only chance the user has
      // to capture it. The dashboard MUST surface a "copy" affordance.
      return {
        id: created.id,
        name: created.name,
        key: `t4t-live-${created.key}`,
        createdAt: created.createdAt,
      };
    },
    {
      body: t.Object({ name: t.Optional(t.String()) }),
    },
  )
  .delete(
    '/:id',
    async ({ user, params, set }) => {
      const row = await prisma.apiKey.findUnique({ where: { id: params.id } });
      if (!row || row.userId !== user.userId) {
        set.status = 404;
        throw new Error('API key not found');
      }
      await prisma.apiKey.delete({ where: { id: params.id } });
      return { ok: true };
    },
    { params: t.Object({ id: t.String() }) },
  );
