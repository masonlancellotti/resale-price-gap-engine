import "server-only";
import { type AnalyticsDTO, computeDemoAnalytics, Desk, seedDemo } from "@flip-desk/api";
import { configFromEnv, createRuntime } from "@flip-desk/runtime";

/**
 * Server-side Desk singleton (plan §14). One store per server process, seeded once by running the
 * real engine over the demo corpus. Approvals mutate this same store, so the UI reflects decisions
 * across requests. FLIP_DB_PATH swaps in SQLite persistence (createRuntime); the default demo stays
 * in-memory and keyless. The Analytics payload is a real 90-day simulation computed once at boot.
 */
interface DeskHandle {
  readonly desk: Desk;
  readonly mode: { http: string; llm: string; store: string };
}

let handle: Promise<DeskHandle> | null = null;
let analytics: Promise<AnalyticsDTO> | null = null;

export function getDesk(): Promise<DeskHandle> {
  if (!handle) {
    handle = (async () => {
      const runtime = await createRuntime(configFromEnv(process.env as Record<string, string | undefined>));
      await seedDemo(runtime.store);
      return { desk: new Desk(runtime.store), mode: runtime.mode };
    })();
  }
  return handle;
}

/** The canned 90-day simulation analytics — computed once (real sim), reused across requests. */
export function getAnalytics(): Promise<AnalyticsDTO> {
  if (!analytics) analytics = computeDemoAnalytics();
  return analytics;
}
