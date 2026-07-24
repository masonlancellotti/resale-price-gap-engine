import { BoundedChannel } from "./channel.js";

/** Stable FNV-1a hash so shard routing is deterministic across runs (no Math.random). */
export function hashKey(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Sharded ingestion (plan §16 Phase 5). Items are routed to one of N bounded channels by a stable key
 * (source or category). Each shard has independent capacity, so a slow/failing source backs up only
 * ITS shard — the blast-radius isolation that keeps one bad adapter from stalling the whole pipeline.
 */
export class ShardRouter<T> {
  readonly #shards: BoundedChannel<T>[];

  constructor(
    readonly shardCount: number,
    capacityPerShard: number,
  ) {
    if (shardCount < 1) throw new Error("shardCount must be >= 1");
    this.#shards = Array.from({ length: shardCount }, () => new BoundedChannel<T>(capacityPerShard));
  }

  shardFor(key: string): number {
    return hashKey(key) % this.shardCount;
  }

  shard(index: number): BoundedChannel<T> {
    const s = this.#shards[index];
    if (!s) throw new Error(`no shard ${index}`);
    return s;
  }

  push(key: string, item: T): Promise<void> {
    return this.shard(this.shardFor(key)).push(item);
  }

  tryPush(key: string, item: T): boolean {
    return this.shard(this.shardFor(key)).tryPush(item);
  }

  pull(key: string): Promise<T> {
    return this.shard(this.shardFor(key)).pull();
  }

  /** Depth of each shard — for backpressure/lag metrics (plan §10.5). */
  depths(): number[] {
    return this.#shards.map((s) => s.size);
  }
}
