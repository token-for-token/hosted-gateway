import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { env } from './env';
import { logger } from './logger';
import { authRoutes } from './auth/routes';
import { usersRoutes } from './users/routes';
import { accountsRoutes } from './accounts/routes';
import { apiKeysRoutes } from './apiKeys/routes';
import { gatewayRoutes } from './gateway/routes';
import { pssInboxRoutes } from './gateway/pssInbox';
import { beeRoutes } from './bee/routes';
import { getGatewayContext } from './gateway/context';

const app = new Elysia()
  .use(cors())
  .use(swagger())
  .get('/', ({ redirect }) => redirect('/swagger', 302))
  .onError(({ error, set }) => {
    const status = set.status ?? 500;
    const message = (error as Error).message ?? 'Internal error';
    logger.warn({ status, message }, 'request errored');
    return { error: message };
  })
  .get('/health', () => ({ ok: true, ts: Date.now() }))
  .use(authRoutes)
  .use(usersRoutes)
  .use(accountsRoutes)
  .use(apiKeysRoutes)
  .use(beeRoutes)
  .use(pssInboxRoutes)
  .use(gatewayRoutes);

// Start the HTTP server immediately so auth / accounts / api-keys routes are
// reachable without waiting on Bee + Gnosis RPC. The gateway context is booted
// lazily (in the background) — if it fails, only `/v1/*` routes degrade. This
// makes auth-only test runs decouple from the chain/Bee stack.
app.listen(env.HOSTED_GATEWAY_PORT, () => {
  logger.info({ port: env.HOSTED_GATEWAY_PORT }, 'hosted gateway api ready');
});

getGatewayContext().catch((err) => {
  logger.error(
    { err: err.message },
    'gateway context boot failed — /v1 chat completions will return 503 until this is resolved',
  );
});
