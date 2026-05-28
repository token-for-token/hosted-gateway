import { z } from 'zod';

const HexAddress = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'must be a 0x-prefixed 20-byte hex address');

const HexPrivateKey = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'must be a 0x-prefixed 32-byte hex key');

const HexBatchId = z
  .string()
  .regex(/^[a-fA-F0-9]{64}$/, 'must be a 32-byte hex postage batch id')
  .optional()
  .or(z.literal(''));

const BigIntString = z
  .string()
  .regex(/^\d+$/, 'must be a non-negative integer (base 10)');

const EnvSchema = z.object({
  // Postgres / Redis
  DATABASE_URL: z.string().url(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  // Auth
  JWT_SECRET_KEY: z.string().min(16, 'JWT_SECRET_KEY must be at least 16 chars'),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),

  // Operator wallet (the only on-chain identity)
  OPERATOR_PRIVATE_KEY: HexPrivateKey,
  GNOSIS_RPC_URL: z.string().url(),

  // T4T protocol contract addresses (on Gnosis Chain)
  REGISTRY_ADDRESS: HexAddress,
  ESCROW_ADDRESS: HexAddress,
  XBZZ_ADDRESS: HexAddress,

  // Bee node + postage
  BEE_API_URL: z.string().url(),
  BEE_POSTAGE_BATCH_ID: HexBatchId,
  BEE_STAMP_MANAGE: z
    .union([z.string(), z.boolean()])
    .transform((v) => v === true || v === 'true' || v === '1')
    .default('false'),
  BEE_STAMP_LABEL: z.string().default('hosted-gateway'),
  BEE_STAMP_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Pricing
  MARKUP_BPS: z.coerce.number().int().min(0).max(10_000).default(2_000),
  WELCOME_XBZZ_WEI: BigIntString.default('50000000000000000000'), // 50 xBZZ

  // Concurrency
  MAX_CONCURRENT_JOBS: z.coerce.number().int().positive().default(200),

  // Server
  HOSTED_GATEWAY_PORT: z.coerce.number().int().positive().default(8080),
  // Public base URL of this gateway, advertised to providers in job_notify
  // envelopes as `clientReplyUrl`. Providers POST ack/deliver here when PSS
  // reverse delivery is unreliable (e.g. Bee 2.8 push-routing skips us).
  PUBLIC_API_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Operator PSS keypair file. All `prod_api` and `prod_worker` replicas
  // share this key so providers can encrypt their PSS replies to a single
  // identity. The compose mounts a named volume at /data so the key persists
  // across deploys and is visible to every replica.
  PSS_KEY_PATH: z.string().default('/data/pss.key'),

  // Phase 2 — Stripe (optional)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema> & {
  WELCOME_XBZZ_WEI_BIGINT: bigint;
};

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return {
    ...parsed.data,
    WELCOME_XBZZ_WEI_BIGINT: BigInt(parsed.data.WELCOME_XBZZ_WEI),
  };
}

export const env: Env = loadEnv();
