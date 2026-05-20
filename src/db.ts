// `model.<entity>.{create,update,delete}` wrappers that persist via Prisma AND
// enqueue a BullMQ job atomically. Raw reads still go through `prisma.x`.
//
// Pattern ported from cipherdolls/core/src/db.ts.

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createCudService } from './queue/service';
import { env } from './env';

// Make BigInt JSON-serializable (used by BullMQ when stringifying job payloads).
// Safe because every BigInt we send through queues is xBZZ wei or token counts,
// neither of which loses precision when stringified.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Prisma 7 ships the query engine as a driver adapter — `@prisma/adapter-pg`
// wraps node-postgres. The schema no longer carries a `datasource.url`; CLI
// tools (migrate, generate, db push) read from prisma.config.ts, while the
// runtime client receives the adapter here.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });

// Each delegate is wrapped to: persist via Prisma → enqueue `created/updated/deleted`.
// The queue name MUST match the BullMQ worker registered in src/queue/startup.ts.
export const model = {
  user: createCudService('user', prisma.user),
  account: createCudService('account', prisma.account),
  apiKey: createCudService('apiKey', prisma.apiKey),
  ledgerEntry: createCudService('ledgerEntry', prisma.ledgerEntry),
  gatewayJob: createCudService('gatewayJob', prisma.gatewayJob),
  topup: createCudService('topup', prisma.topup),
};
