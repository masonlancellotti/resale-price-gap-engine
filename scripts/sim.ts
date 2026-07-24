#!/usr/bin/env tsx
/**
 * FLIP DESK simulation CLI (V2 WS2).
 *
 *   npm run sim -- --days 90 --seed 42 --out reports/sim-90d.html
 *
 * Runs the deterministic marketplace simulation, computes the tearsheet, and writes a self-contained
 * HTML report (plus a markdown twin). Same seed → identical output.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { computeTearsheet, renderHtml, renderMarkdown, runSim } from "@flip-desk/sim";
import { formatCents } from "@flip-desk/money";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

async function main(): Promise<void> {
  const days = Number.parseInt(arg("days", "90"), 10);
  const seed = Number.parseInt(arg("seed", "42"), 10);
  const out = arg("out", `reports/sim-${days}d.html`);
  const mdOut = out.replace(/\.html?$/i, ".md");

  process.stdout.write(`Running simulation — ${days} days, seed ${seed} …\n`);
  const result = await runSim({ days, seed });
  const t = computeTearsheet(result);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, renderHtml(result, t), "utf8");
  writeFileSync(mdOut, renderMarkdown(result, t), "utf8");

  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  process.stdout.write(
    [
      `\nSIMULATED (synthetic) — see docs/SIMULATION.md`,
      `  listings ....... ${result.listingsSeen} seen · ${result.listingsTaken} bought · ${t.flips} flips`,
      `  money-wtd rtn .. ${pct(t.moneyWeightedReturn)} (90d)   total return ${pct(t.totalReturn)}`,
      `  net profit ..... ${formatCents(t.netProfitCents)}   final equity ${formatCents(t.finalEquityCents)}`,
      `  hit rate ....... ${pct(t.hitRate)}   max drawdown ${pct(t.maxDrawdown)}`,
      `  calibration .... P10-P90 ${pct(t.calibration.coverageP10P90)} (nominal 80%) · P25-P75 ${pct(t.calibration.coverageP25P75)} (nominal 50%)`,
      `  capital used ... ${pct(t.capitalUtilization)}   fee burden ${pct(t.feeBurden)}`,
      `\nWrote ${out}`,
      `Wrote ${mdOut}\n`,
    ].join("\n"),
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
