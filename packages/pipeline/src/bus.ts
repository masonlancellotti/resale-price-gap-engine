/**
 * A minimal in-process FIFO queue standing in for the BullMQ ingest bus (plan §5.1, §5.2). The
 * interface is deliberately narrow so a Redis/BullMQ-backed implementation can drop in behind it
 * without touching callers ("scale-out is a config change, not a rewrite").
 */
export interface Queue<T> {
  add(item: T): void;
  /** Process items until the queue is empty; returns how many were handled. */
  drain(handler: (item: T) => Promise<void> | void): Promise<number>;
  readonly size: number;
}

export class InMemoryQueue<T> implements Queue<T> {
  #items: T[] = [];

  add(item: T): void {
    this.#items.push(item);
  }

  get size(): number {
    return this.#items.length;
  }

  async drain(handler: (item: T) => Promise<void> | void): Promise<number> {
    let handled = 0;
    for (;;) {
      const item = this.#items.shift();
      if (item === undefined) break;
      await handler(item);
      handled++;
    }
    return handled;
  }
}
