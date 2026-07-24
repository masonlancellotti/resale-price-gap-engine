import type { Band } from "@flip-desk/rank";

/** A delivered alert record (plan §6 `alert`). */
export interface Alert {
  readonly opportunityExternalId: string;
  readonly band: Band;
  readonly channel: string;
  readonly sentAt: string;
  readonly score: number;
}

/** A notification sink — ntfy/Pushover/SMS in production; a collector in tests (plan §4.4). */
export interface Notifier {
  send(alert: Alert): void | Promise<void>;
}

export class CollectingNotifier implements Notifier {
  readonly sent: Alert[] = [];
  send(alert: Alert): void {
    this.sent.push(alert);
  }
}

/**
 * Banding → channel routing (plan §7.6, §11.2). push → instant channel; feed → the triage feed;
 * digest → daily digest; archive → silent (still watched for regret data).
 */
export class Alerter {
  constructor(
    private readonly notifier: Notifier,
    private readonly now: () => Date = () => new Date(),
  ) {}

  channelFor(band: Band): string | undefined {
    switch (band) {
      case "push":
        return "push";
      case "feed":
        return "feed";
      case "digest":
        return "digest";
      case "archive":
        return undefined; // no delivery
    }
  }

  async maybeAlert(opportunityExternalId: string, band: Band, score: number): Promise<Alert | undefined> {
    const channel = this.channelFor(band);
    if (!channel) return undefined;
    const alert: Alert = {
      opportunityExternalId,
      band,
      channel,
      score,
      sentAt: this.now().toISOString(),
    };
    await this.notifier.send(alert);
    return alert;
  }
}
