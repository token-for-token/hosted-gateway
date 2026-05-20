import { closeAll, registerWorker } from './registry';
import { logger } from '../logger';

// Per-entity processors registered as they're built (Phase 1 onwards).
// Import lazily so worker.ts can call startWorkers() without pulling in api
// surface code.

export function startWorkers() {
  logger.info('starting BullMQ workers…');

  // Domain processors — added module-by-module as we build them.
  // Example wiring (uncomment once the module ships):
  //   import { usersProcessor } from '../users/processor';
  //   registerWorker('user', (job) => usersProcessor.process(job));

  const { usersProcessor } = require('../users/processor');
  registerWorker('user', (job: any) => usersProcessor.process(job));

  const { accountsProcessor } = require('../accounts/processor');
  registerWorker('account', (job: any) => accountsProcessor.process(job));

  logger.info('BullMQ workers registered');
}

export async function stopWorkers() {
  await closeAll();
}
