import type { Job } from 'bullmq';
import type { User } from '@prisma/client';
import { BaseProcessor } from '../queue/processor';
import { model, prisma } from '../db';
import { creditWelcomeGrant } from '../accounts/ledger';
import { logger } from '../logger';

const USER_FIELDS = ['email', 'emailVerified', 'role', 'stripeCustomerId', 'country'] as const;

class UsersProcessor extends BaseProcessor<User> {
  constructor() {
    super('user', USER_FIELDS);
  }

  /** New user → create their Account (which in turn triggers the welcome grant
   *  if the user is already email-verified, e.g. via Google OAuth). */
  protected async onCreated(_job: Job, user: User): Promise<void> {
    await model.account.create({
      data: {
        userId: user.id,
        balanceXbzzWei: '0',
        reservedXbzzWei: '0',
      },
    });
  }

  /**
   * Field-level handlers fire when a scalar column changes (computed by
   * BaseProcessor's diff). We watch `emailVerified` so email-signup users who
   * verify *after* their account row exists still get the welcome grant.
   * Idempotent — `creditWelcomeGrant` keys on the account id.
   */
  protected getFieldHandlers(_job: Job, entity: User): Record<string, () => Promise<void>> {
    return {
      emailVerified: async () => {
        if (!entity.emailVerified) return; // only fire on false → true
        const account = await prisma.account.findUnique({
          where: { userId: entity.id },
          select: { id: true },
        });
        if (!account) {
          logger.warn({ userId: entity.id }, 'verified user has no account row yet — skipping grant');
          return;
        }
        await creditWelcomeGrant(account.id);
      },
    };
  }
}

export const usersProcessor = new UsersProcessor();
