import { getQueue } from './registry';

/** Recursively convert BigInt → string so BullMQ's JSON.stringify can serialize. */
function serializeBigInts(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const result: any = {};
    for (const [k, v] of Object.entries(obj)) result[k] = serializeBigInts(v);
    return result;
  }
  return obj;
}

/**
 * Wraps a Prisma model delegate so CUD calls persist AND enqueue a BullMQ job.
 * Reads stay on `prisma.x` directly.
 *
 * Ported from cipherdolls/core/src/queue/service.ts.
 */
export function createCudService<T>(
  queueName: string,
  prismaDelegate: {
    create: (args: any) => Promise<T>;
    update: (args: any) => Promise<T>;
    delete: (args: any) => Promise<T>;
    findUnique: (args: any) => Promise<T | null>;
  },
) {
  const queue = getQueue(queueName);

  return {
    async create(args: any): Promise<T> {
      const entity = await prismaDelegate.create(args);
      await queue.add('created', { [queueName]: serializeBigInts(entity) });
      return entity;
    },

    async update(args: { where: any; data: any; include?: any }, original?: T): Promise<T> {
      if (!original) {
        original = (await prismaDelegate.findUnique({ where: args.where })) as T;
      }
      const entity = await prismaDelegate.update(args);
      await queue.add('updated', {
        [queueName]: serializeBigInts(entity),
        original: serializeBigInts(original),
      });
      return entity;
    },

    async delete(args: { where: any }): Promise<T> {
      const entity = await prismaDelegate.findUnique({ where: args.where });
      await queue.add('deleted', { [queueName]: serializeBigInts(entity) });
      return prismaDelegate.delete(args);
    },
  };
}
