import { Queue, Worker, type Job, type Processor } from 'bullmq';
import { queueConnection } from './connection';
import { logger } from '../logger';

const defaultOpts = { concurrency: 1 };

const queues = new Map<string, Queue>();
const workers = new Map<string, Worker>();

export function getQueue<T = any>(name: string): Queue<T> {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection: queueConnection }));
  }
  return queues.get(name)! as Queue<T>;
}

export function registerWorker<T = any>(
  name: string,
  handler: Processor<T>,
  opts?: { concurrency?: number },
): Worker<T> {
  const worker = new Worker<T>(name, handler, {
    connection: queueConnection,
    concurrency: opts?.concurrency ?? defaultOpts.concurrency,
    autorun: true,
  });

  worker.on('failed', (job: Job<T> | undefined, err: Error) => {
    logger.error({ queue: name, jobId: job?.id, jobName: job?.name, err: err.message }, 'job failed');
  });

  worker.on('completed', (job: Job<T>) => {
    logger.debug({ queue: name, jobId: job.id, jobName: job.name }, 'job completed');
  });

  workers.set(name, worker);
  return worker;
}

export async function closeAll() {
  for (const w of workers.values()) await w.close();
  for (const q of queues.values()) await q.close();
}
