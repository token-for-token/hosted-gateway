import type { Job } from 'bullmq';
import type { Account } from '@prisma/client';
import { BaseProcessor } from '../queue/processor';
import { prisma } from '../db';
import { creditWelcomeGrant } from './ledger';
import { logger } from '../logger';

const ACCOUNT_FIELDS = ['status', 'balanceXbzzWei', 'reservedXbzzWei'] as const;

class AccountsProcessor extends BaseProcessor<Account> {
  constructor() {
    super('account', ACCOUNT_FIELDS);
  }

  /**
   * On account creation, credit the welcome grant — but only if the user's
   * email is verified (Google sub is verified by default; email-signup users
   * must complete the verify link first).
   */
  protected async onCreated(_job: Job, account: Account): Promise<void> {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: account.userId },
      select: { emailVerified: true },
    });
    if (!user.emailVerified) {
      logger.info(
        { accountId: account.id, userId: account.userId },
        'welcome grant deferred — email not verified',
      );
      return;
    }
    await creditWelcomeGrant(account.id);
  }
}

export const accountsProcessor = new AccountsProcessor();
