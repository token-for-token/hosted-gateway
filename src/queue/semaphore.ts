/**
 * Simple in-process counting semaphore for the chat-completion concurrency cap.
 * Bounds Bee / Gnosis RPC / Postgres pressure when many concurrent users hit
 * `/v1/chat/completions`.
 *
 * Not Redis-distributed — each api process keeps its own counter. With Phase 1
 * being a single api process this is sufficient; Phase 3 (horizontal scale)
 * will replace with a Redis token bucket.
 */
export class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {
    this.available = capacity;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  /** Non-blocking variant: returns false if capacity is exhausted. */
  tryAcquire(): boolean {
    if (this.available > 0) {
      this.available -= 1;
      return true;
    }
    return false;
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.available = Math.min(this.available + 1, this.capacity);
    }
  }

  get inFlight(): number {
    return this.capacity - this.available;
  }
}
