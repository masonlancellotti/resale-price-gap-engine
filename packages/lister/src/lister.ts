import type { ConditionBand, Product, PublishInput } from "@flip-desk/core";
import type { Cents } from "@flip-desk/money";
import { buildDescription, buildSpecifics, buildTitle, profileFor } from "./content.js";
import { FakePhotoProcessor, type PhotoProcessor, type ProcessedPhoto } from "./photos.js";

export interface ListableItem {
  readonly sku: string;
  readonly product: Product;
  readonly conditionBand: ConditionBand;
  readonly priceCents: Cents;
  readonly sourcePhotoKeys: readonly string[];
  readonly defects?: readonly string[];
  readonly handlingDays?: number;
}

/** A ready-to-publish draft. Extends the core {@link PublishInput} so a Publisher can take it as-is. */
export interface ListingDraft extends PublishInput {
  readonly sku: string;
  /** The verified band this copy was written to — lets tests assert honesty (never upsold). */
  readonly honestCondition: ConditionBand;
  readonly photos: readonly ProcessedPhoto[];
}

export interface ListerOptions {
  readonly photoProcessor?: PhotoProcessor;
}

/**
 * The Lister (plan §5.3 #4, §8.7): turns a received inventory item into per-platform listing drafts —
 * platform-shaped copy + a processed photo set with a stable idempotency key so republishing is
 * exactly-once (plan §5.4). It does not publish; a {@link import("@flip-desk/core").Publisher} does.
 */
export class Lister {
  private readonly photos: PhotoProcessor;

  constructor(opts: ListerOptions = {}) {
    this.photos = opts.photoProcessor ?? new FakePhotoProcessor();
  }

  async draftFor(item: ListableItem, platform: string): Promise<ListingDraft> {
    const profile = profileFor(platform);
    const photos = await Promise.all(item.sourcePhotoKeys.map((k) => this.photos.process(k, profile.crop)));
    return {
      sku: item.sku,
      platform,
      title: buildTitle(item.product, item.conditionBand, profile),
      description: buildDescription(item.product, item.conditionBand, {
        ...(item.defects ? { defects: item.defects } : {}),
        ...(item.handlingDays !== undefined ? { handlingDays: item.handlingDays } : {}),
      }),
      priceCents: item.priceCents,
      specifics: buildSpecifics(item.product, item.conditionBand),
      photoKeys: photos.map((p) => p.key),
      idempotencyKey: `list:${item.sku}:${platform}`,
      honestCondition: item.conditionBand,
      photos,
    };
  }

  /** Draft the same item across several exit channels (multichannel — plan §8.7, delist saga §10.4). */
  async draftAll(item: ListableItem, platforms: readonly string[]): Promise<ListingDraft[]> {
    return Promise.all(platforms.map((p) => this.draftFor(item, p)));
  }
}
