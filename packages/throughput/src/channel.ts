/**
 * Bounded channel with backpressure (plan §16 Phase 5, §10.2). A producer that outruns its consumer
 * BLOCKS on `push` once the buffer is full, instead of letting an unbounded queue balloon memory and
 * hide the fact that we're behind. This is the core primitive for sharded ingestion — each shard gets
 * its own bounded channel so one slow source can't starve or OOM the others.
 */
export class BoundedChannel<T> {
  readonly #buf: T[] = [];
  readonly #pushWaiters: Array<() => void> = [];
  readonly #pullWaiters: Array<(v: T) => void> = [];
  #closed = false;

  constructor(readonly capacity: number) {
    if (capacity < 1) throw new Error("capacity must be >= 1");
  }

  get size(): number {
    return this.#buf.length;
  }

  /** Number of producers currently blocked waiting for room (backpressure signal). */
  get waitingProducers(): number {
    return this.#pushWaiters.length;
  }

  /** Push an item; resolves immediately if there's room or a waiting consumer, else awaits room. */
  async push(item: T): Promise<void> {
    if (this.#closed) throw new Error("channel closed");
    const consumer = this.#pullWaiters.shift();
    if (consumer) {
      consumer(item); // hand straight to a waiting consumer
      return;
    }
    if (this.#buf.length >= this.capacity) {
      await new Promise<void>((res) => this.#pushWaiters.push(res));
    }
    this.#buf.push(item);
  }

  /** Non-blocking push; returns false (rejected) if the buffer is full. */
  tryPush(item: T): boolean {
    const consumer = this.#pullWaiters.shift();
    if (consumer) {
      consumer(item);
      return true;
    }
    if (this.#buf.length >= this.capacity) return false;
    this.#buf.push(item);
    return true;
  }

  /** Pull an item; resolves immediately if buffered, else awaits the next push. */
  async pull(): Promise<T> {
    const item = this.#buf.shift();
    if (item !== undefined) {
      this.#wakeProducer();
      return item;
    }
    return new Promise<T>((res) => this.#pullWaiters.push(res));
  }

  #wakeProducer(): void {
    const producer = this.#pushWaiters.shift();
    if (producer) producer();
  }

  close(): void {
    this.#closed = true;
  }
}
