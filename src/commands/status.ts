import { loadConfig, paths } from "../config";
import { createBusinessTimeContext } from "../business-time";
import { loadPTOIntervals, loadBudgetRuns } from "../storage";
import { computeSLI } from "../slo";

export async function statusCommand(): Promise<void> {
  const config = await loadConfig();
  const now = new Date();

  // Load data
  const ptoIntervals = await loadPTOIntervals();
  const budgetRuns = await loadBudgetRuns();

  // Create business time context for rolling window
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - config.slo.windowDays);

  const ctx = await createBusinessTimeContext(
    config,
    ptoIntervals,
    windowStart,
    now
  );

  // Compute current SLI
  const sli = computeSLI(budgetRuns, windowStart, now, ctx);

  console.log("=== PR Review SLO Status ===");
  console.log(`GitHub user: ${config.github.username || "(not configured)"}`);
  console.log(`Data directory: ${paths.dataDir}`);
  console.log(`Total budget runs: ${budgetRuns.length}`);
  console.log();

  console.log("=== Current SLI (30-day rolling window) ===");
  console.log(`Window: ${windowStart.toISOString()} to ${now.toISOString()}`);
  console.log(`Total business minutes: ${sli.totalBusinessMinutes}`);
  console.log(`Good minutes: ${sli.goodMinutes}`);
  console.log(`Bad minutes: ${sli.badMinutes}`);
  console.log(`SLI: ${(sli.sli * 100).toFixed(2)}%`);
  console.log(`Target: ${(config.slo.target * 100).toFixed(0)}%`);
  console.log(`Budget: ${sli.budgetMinutes.toFixed(0)} minutes`);
  console.log(`Budget remaining: ${sli.budgetRemaining.toFixed(0)} minutes`);
  console.log(`Status: ${sli.isMet ? "✓ SLO MET" : "✗ SLO VIOLATED"}`);

  // Last run info
  if (budgetRuns.length > 0) {
    const lastRun = budgetRuns[budgetRuns.length - 1]!;
    console.log();
    console.log("=== Last Run ===");
    console.log(`Time: ${lastRun.runAt}`);
    console.log(`PRs in queue: ${lastRun.prs.length}`);
    console.log(`Bad minutes: ${lastRun.badMinutes}`);
  }

  // Configuration summary
  console.log();
  console.log("=== Configuration ===");
  console.log(
    `Business hours: ${config.businessHours.start}:00-${config.businessHours.end}:00 (${config.businessHours.timezone})`
  );
  console.log(
    `Business days: ${config.businessDays.map((d) => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]).join(", ")}`
  );
  console.log(`Holiday country: ${config.holidayCountryCode}`);
  console.log(
    `Size buckets: Small (<${config.sizeBuckets.small.maxLoc} LOC, ${config.sizeBuckets.small.businessDays}d), Medium (<${config.sizeBuckets.medium.maxLoc} LOC, ${config.sizeBuckets.medium.businessDays}d)`
  );

  // Active PTO
  const today = now.toISOString().slice(0, 10);
  const activePTO = ptoIntervals.filter((p) => p.end >= today);
  if (activePTO.length > 0) {
    console.log();
    console.log("=== Active/Future PTO ===");
    for (const p of activePTO) {
      console.log(`  ${p.start} to ${p.end}`);
    }
  }
}
