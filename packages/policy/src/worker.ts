import type { ActionScope, KillSwitch } from "./killswitch.js";

export interface WorkerResult {
  readonly processed: number;
  readonly halted: boolean;
}

/**
 * A cooperative worker loop. It subscribes to the {@link KillSwitch} for its scope and checks the
 * abort signal before and after every unit of work, so a tripped switch stops it promptly and
 * leaves it in a clean state — the essence of P7 (halt, don't sneak). Real workers (ingest,
 * repricer, negotiator) wrap their per-item work in this same guard.
 */
export class Worker<T> {
  constructor(
    readonly name: string,
    private readonly killSwitch: KillSwitch,
    private readonly scope: ActionScope = {},
  ) {}

  async run(source: AsyncIterable<T>, handle: (item: T) => Promise<void> | void): Promise<WorkerResult> {
    const scope: ActionScope = { ...this.scope, agent: this.scope.agent ?? this.name };
    const signal = this.killSwitch.register(scope);
    let processed = 0;
    try {
      if (signal.aborted) return { processed, halted: true };
      for await (const item of source) {
        if (signal.aborted) return { processed, halted: true };
        await handle(item);
        processed++;
        if (signal.aborted) return { processed, halted: true };
      }
      return { processed, halted: signal.aborted };
    } finally {
      this.killSwitch.deregister(signal);
    }
  }
}
