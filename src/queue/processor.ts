import type { Job } from 'bullmq';
import { isDeepStrictEqual } from 'node:util';
import { logger } from '../logger';

/**
 * Base processor for the CUD-and-enqueue pattern. Subclasses override
 * `onCreated` / `getFieldHandlers` / `onDeleted`.
 *
 * Ported from cipherdolls/core/src/queue/processor.ts. `publishProcessEvent`
 * is dropped — MQTT broker arrives in Phase 3.
 */
export abstract class BaseProcessor<T extends Record<string, any>> {
  constructor(
    protected readonly entityName: string,
    protected readonly scalarFields: readonly string[],
  ) {}

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'created':
        return this.handleCreated(job);
      case 'updated':
        return this.handleUpdated(job);
      case 'deleted':
        return this.handleDeleted(job);
      default:
        logger.warn({ entity: this.entityName, jobName: job.name }, 'unknown job name');
    }
  }

  protected async handleCreated(job: Job): Promise<void> {
    const entity = job.data[this.entityName] as T;
    logger.debug({ entity: this.entityName, id: entity?.id }, 'created');
    try {
      await this.onCreated(job, entity);
    } catch (err: any) {
      logger.error({ entity: this.entityName, id: entity?.id, err: err.message }, 'onCreated failed');
      throw err;
    }
  }

  protected async handleUpdated(job: Job): Promise<void> {
    const entity = job.data[this.entityName] as T;
    const original = job.data.original as T | undefined;
    if (!original) {
      logger.warn({ entity: this.entityName, id: entity?.id }, 'updated without original snapshot');
      return;
    }
    const updatedFields = this.scalarFields.filter(
      (key) => !isDeepStrictEqual((original as any)[key], (entity as any)[key]),
    );
    if (updatedFields.length === 0) return;

    logger.debug(
      { entity: this.entityName, id: entity?.id, fields: updatedFields },
      'updated',
    );
    try {
      const handlers = this.getFieldHandlers(job, entity);
      for (const field of updatedFields) {
        const handler = handlers[field];
        if (handler) await handler();
      }
      await this.onUpdated(job, entity, original, updatedFields);
    } catch (err: any) {
      logger.error(
        { entity: this.entityName, id: entity?.id, err: err.message },
        'onUpdated failed',
      );
      throw err;
    }
  }

  protected async handleDeleted(job: Job): Promise<void> {
    const entity = job.data[this.entityName] as T;
    logger.debug({ entity: this.entityName, id: entity?.id }, 'deleted');
    await this.onDeleted(job, entity);
  }

  protected async onCreated(_job: Job, _entity: T): Promise<void> {}
  protected async onUpdated(
    _job: Job,
    _entity: T,
    _original: T,
    _updatedFields: string[],
  ): Promise<void> {}
  protected async onDeleted(_job: Job, _entity: T): Promise<void> {}

  protected getFieldHandlers(_job: Job, _entity: T): Record<string, () => Promise<void>> {
    return {};
  }
}
