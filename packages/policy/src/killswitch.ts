/**
 * Kill switches (plan §9.4, §14.2 HEALTH board). Global, per-source, per-agent, and per-platform.
 * They **win over everything** — no policy edit can override a tripped switch — and they are the
 * mechanical half of P7 (stop, don't sneak): the Sentinel trips the relevant switch on any block/
 * ban/lockout, and every worker subscribed to that scope aborts at once.
 */

export type KillScope =
  | { readonly kind: "global" }
  | { readonly kind: "source"; readonly code: string }
  | { readonly kind: "agent"; readonly name: string }
  | { readonly kind: "platform"; readonly name: string };

/** The scope an action/worker belongs to. Any dimension left undefined simply can't be scope-halted. */
export interface ActionScope {
  readonly source?: string;
  readonly agent?: string;
  readonly platform?: string;
}

export class KillSwitchHalt extends Error {
  constructor(readonly scope: ActionScope) {
    super("halted by kill switch");
    this.name = "KillSwitchHalt";
  }
}

export class KillSwitch {
  #global = false;
  readonly #sources = new Set<string>();
  readonly #agents = new Set<string>();
  readonly #platforms = new Set<string>();
  readonly #registered = new Map<AbortController, ActionScope>();

  trip(scope: KillScope): void {
    switch (scope.kind) {
      case "global":
        this.#global = true;
        break;
      case "source":
        this.#sources.add(scope.code);
        break;
      case "agent":
        this.#agents.add(scope.name);
        break;
      case "platform":
        this.#platforms.add(scope.name);
        break;
    }
    this.#propagate();
  }

  reset(scope: KillScope): void {
    switch (scope.kind) {
      case "global":
        this.#global = false;
        break;
      case "source":
        this.#sources.delete(scope.code);
        break;
      case "agent":
        this.#agents.delete(scope.name);
        break;
      case "platform":
        this.#platforms.delete(scope.name);
        break;
    }
  }

  isHalted(scope: ActionScope = {}): boolean {
    if (this.#global) return true;
    if (scope.source !== undefined && this.#sources.has(scope.source)) return true;
    if (scope.agent !== undefined && this.#agents.has(scope.agent)) return true;
    if (scope.platform !== undefined && this.#platforms.has(scope.platform)) return true;
    return false;
  }

  /**
   * Register a worker's scope and receive an {@link AbortSignal} that fires the instant its scope is
   * halted (including immediately, if it's already halted at registration time).
   */
  register(scope: ActionScope = {}): AbortSignal {
    const controller = new AbortController();
    this.#registered.set(controller, scope);
    if (this.isHalted(scope)) controller.abort(new KillSwitchHalt(scope));
    return controller.signal;
  }

  /** Stop tracking a controller (call when a worker exits, to avoid unbounded growth). */
  deregister(signal: AbortSignal): void {
    for (const [controller] of this.#registered) {
      if (controller.signal === signal) {
        this.#registered.delete(controller);
        return;
      }
    }
  }

  #propagate(): void {
    for (const [controller, scope] of this.#registered) {
      if (!controller.signal.aborted && this.isHalted(scope)) {
        controller.abort(new KillSwitchHalt(scope));
      }
    }
  }

  get status(): { global: boolean; sources: string[]; agents: string[]; platforms: string[] } {
    return {
      global: this.#global,
      sources: [...this.#sources],
      agents: [...this.#agents],
      platforms: [...this.#platforms],
    };
  }
}
