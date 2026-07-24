import "server-only";
import { Desk, seedDemo } from "@flip-desk/api";
import { configFromEnv, buildRuntime } from "@flip-desk/runtime";

/**
 * Server-side Desk singleton (plan §14). One in-memory store per server process, seeded once by
 * running the real engine over the demo corpus. Approvals mutate this same store, so the UI reflects
 * decisions across requests. Swapping to a live runtime (Postgres + Anthropic) is a config change in
 * @flip-desk/runtime — nothing here changes.
 */
interface DeskHandle {
  readonly desk: Desk;
  readonly mode: { http: string; llm: string; store: string };
}

let handle: Promise<DeskHandle> | null = null;

export function getDesk(): Promise<DeskHandle> {
  if (!handle) {
    handle = (async () => {
      const runtime = buildRuntime(configFromEnv(process.env as Record<string, string | undefined>));
      await seedDemo(runtime.store);
      return { desk: new Desk(runtime.store), mode: runtime.mode };
    })();
  }
  return handle;
}
