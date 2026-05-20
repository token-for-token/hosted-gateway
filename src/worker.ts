import { startWorkers, stopWorkers } from './queue/startup';
import { startClaimWatcher } from './chain/claimWatcher';
import { startBalanceMonitor } from './chain/balanceMonitor';
import { logger } from './logger';

startWorkers();
startClaimWatcher();
startBalanceMonitor();

logger.info('worker process up');

const shutdown = async (sig: string) => {
  logger.info({ sig }, 'shutting down');
  await stopWorkers();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
