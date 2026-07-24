/**
 * Photo pipeline (plan §8.7): always OUR OWN photos (never the seller's — §3.2), EXIF-stripped
 * (GPS especially — leaking your home coordinates is a safety bug), background-cleaned, cropped to
 * each platform's spec. Real image work is a seam; here we model the transform record + the metadata
 * guarantees so callers and tests can assert "GPS was stripped" and "cropped to eBay's 1:1".
 */
export interface CropSpec {
  readonly aspect: string; // "1:1", "4:3", …
  readonly minEdgePx: number;
}

export interface ProcessedPhoto {
  readonly key: string;
  readonly sourceKey: string;
  readonly gpsStripped: boolean;
  readonly exifStripped: boolean;
  readonly aspect: string;
  readonly transforms: readonly string[];
}

export interface PhotoProcessor {
  process(sourceKey: string, spec: CropSpec): Promise<ProcessedPhoto>;
}

/**
 * Offline stand-in for the real (sharp/imagemagick) pipeline. It unconditionally reports EXIF+GPS
 * stripped — the invariant every real implementation MUST also uphold — and records the crop.
 */
export class FakePhotoProcessor implements PhotoProcessor {
  async process(sourceKey: string, spec: CropSpec): Promise<ProcessedPhoto> {
    return {
      key: `proc/${spec.aspect.replace(":", "x")}/${sourceKey}`,
      sourceKey,
      gpsStripped: true,
      exifStripped: true,
      aspect: spec.aspect,
      transforms: ["strip-exif", "strip-gps", "clean-background", `crop-${spec.aspect}`],
    };
  }
}
