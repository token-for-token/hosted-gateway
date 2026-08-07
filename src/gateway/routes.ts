import Elysia, { t } from 'elysia';
import { jwtGuard } from '../auth/jwt';
import { prisma } from '../db';
import { handleChat } from './handleChat';
import { getGatewayContext } from './context';
import { Semaphore } from '../queue/semaphore';
import { env } from '../env';
import { logger } from '../logger';
import { InsufficientBalanceError } from '../accounts/ledger';
import { weiString } from '../lib/decimal';
import { parseLimit } from '../lib/query';

const semaphore = new Semaphore(env.MAX_CONCURRENT_JOBS);

export const gatewayRoutes = new Elysia()
  .use(jwtGuard)
  .get('/v1/models', async () => {
    const ctx = await getGatewayContext();
    const summaries = await ctx.discovery.list();
    const created = Math.floor(Date.now() / 1000);
    return {
      object: 'list',
      data: summaries.map((m) => ({
        id: m.id,
        object: 'model' as const,
        created,
        owned_by: 't4t',
      })),
    };
  })
  .post(
    '/v1/chat/completions',
    async ({ body, user, set }) => {
      if (!semaphore.tryAcquire()) {
        set.status = 503;
        set.headers['Retry-After'] = '5';
        throw new Error('Server busy — too many concurrent jobs in flight');
      }

      try {
        const ctx = await getGatewayContext();
        const { gatewayJobId, response } = await handleChat({
          ctx,
          userId: user.userId,
          req: body as any,
        });
        return response;
      } catch (err: any) {
        if (err instanceof InsufficientBalanceError) {
          set.status = 402;
          throw err;
        }
        logger.error({ err: err.message, userId: user.userId }, 'chat completion failed');
        set.status = 500;
        throw err;
      } finally {
        semaphore.release();
      }
    },
    {
      // Pass through the OpenAI-style payload; we don't enforce the schema
      // strictly — any unknown fields just ride along to the provider.
      body: t.Object(
        {
          model: t.String(),
          messages: t.Array(
            t.Object({
              role: t.Union([
                t.Literal('system'),
                t.Literal('user'),
                t.Literal('assistant'),
                t.Literal('tool'),
              ]),
              content: t.String(),
            }),
          ),
          temperature: t.Optional(t.Number()),
          // Integer-and-positive is enforced here rather than in the pricing
          // math: a fractional `max_tokens` makes `BigInt()` throw (500), and a
          // negative one budgets a negative reservation.
          max_tokens: t.Optional(t.Integer({ minimum: 1 })),
          stream: t.Optional(t.Boolean()),
        },
        { additionalProperties: true },
      ),
    },
  )
  .get('/v1/jobs', async ({ user, query }) => {
    const limit = parseLimit(query.limit);
    const jobs = await prisma.gatewayJob.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        modelId: true,
        provider: true,
        estimatedMaxXbzzWei: true,
        actualXbzzWei: true,
        promptTokens: true,
        completionTokens: true,
        createdAt: true,
        ackedAt: true,
        deliveredAt: true,
        claimedAt: true,
        errorMessage: true,
      },
    });
    return jobs.map((j) => ({
      ...j,
      estimatedMaxXbzzWei: weiString(j.estimatedMaxXbzzWei),
      actualXbzzWei: j.actualXbzzWei ? weiString(j.actualXbzzWei) : null,
    }));
  });
