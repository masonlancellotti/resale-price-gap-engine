/**
 * New-vertical onboarding playbook (plan §16 Phase 5). Adding a category (LEGO, cameras, music gear)
 * shouldn't be tribal knowledge. A {@link VerticalSpec} declares everything a vertical needs to go
 * live; {@link validateVertical} turns the Phase-1 gate criteria (licensed comps, a category profile,
 * an intake checklist, verified fees, a labeled calibration set) into a hard checklist — blockers stop
 * the launch, warnings are advisory. Same bar the games vertical had to clear.
 */
export interface VerticalSpec {
  readonly slug: string;
  readonly categoryId: number;
  readonly displayName: string;
  /** Licensed/official comp providers wired for this category (plan §4.1). */
  readonly compProviders: readonly string[];
  /** A CategoryProfile (fees, effort, thresholds) is registered. */
  readonly hasProfile: boolean;
  /** An intake test checklist exists for the category (plan §8 intake). */
  readonly hasChecklist: boolean;
  /** Fee schedule verified within the last quarter (plan §5.4, re-verify quarterly). */
  readonly feeScheduleVerified: boolean;
  /** Size of the labeled comp set for calibration (Phase-1 gate uses ≥100). */
  readonly labeledSetSize: number;
}

export interface OnboardingCriteria {
  readonly minCompProviders: number;
  readonly minLabeledSet: number;
}

export const DEFAULT_ONBOARDING: OnboardingCriteria = { minCompProviders: 1, minLabeledSet: 100 };

export interface OnboardingResult {
  readonly slug: string;
  readonly ready: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
}

export function validateVertical(spec: VerticalSpec, cfg: OnboardingCriteria = DEFAULT_ONBOARDING): OnboardingResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (spec.compProviders.length < cfg.minCompProviders) blockers.push("no licensed comp provider wired");
  if (!spec.hasProfile) blockers.push("no category profile (fees/effort/thresholds)");
  if (!spec.hasChecklist) blockers.push("no intake test checklist");
  if (!spec.feeScheduleVerified) blockers.push("fee schedule not verified this quarter");
  if (spec.labeledSetSize < cfg.minLabeledSet) {
    blockers.push(`labeled set too small (${spec.labeledSetSize} < ${cfg.minLabeledSet}) — can't gate MAPE`);
  }

  if (spec.compProviders.length < 2) warnings.push("single-provider comps: expect a −5 score penalty (plan §7.6)");

  return { slug: spec.slug, ready: blockers.length === 0, blockers, warnings };
}
