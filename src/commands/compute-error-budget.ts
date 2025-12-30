import { loadConfig } from "../config";
import { fetchInScopePRs } from "../github";
import { createBusinessTimeContext } from "../business-time";
import { loadPTOIntervals, loadBudgetRuns, appendBudgetRun } from "../storage";
import { computePRDeadlines, computeSLI, getMinDeadline } from "../slo";
import type { BudgetRun } from "../types";

export async function computeErrorBudgetContributionCommand(): Promise<void> {
  const config = await loadConfig();
  const now = new Date();

  console.log("Fetching PRs requesting review...");
  const prs = await fetchInScopePRs(config);
  console.log(`Found ${prs.length} PR(s) requesting review.`);

  // Load PTO intervals
  const ptoIntervals = await loadPTOIntervals();

  // Create business time context (need to cover window for SLI calculation)
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - config.slo.windowDays);

  const ctx = await createBusinessTimeContext(
    config,
    ptoIntervals,
    windowStart,
    now
  );

  // Compute deadlines for all PRs (for display)
  const prsWithDeadlines = computePRDeadlines(prs, config, ctx);
  const largePRs = prs.length - prsWithDeadlines.length;
  console.log(`${prsWithDeadlines.length} PR(s) in scope for SLO tracking.`);
  if (largePRs > 0) {
    console.log(`${largePRs} large PR(s) logged but excluded from SLO computation.`);
  }

  // Create and store the budget run (just the facts)
  // Note: This includes ALL PRs, even those too large for SLO tracking.
  // Large PRs will be filtered out during error budget computation.
  const budgetRun: BudgetRun = {
    type: "budget_run",
    runAt: now.toISOString(),
    prs: prs.map((pr) => ({
      url: pr.url,
      title: pr.title,
      requestedAt: pr.requestedAt.toISOString(),
      loc: pr.loc,
      reviewedAt: null,
      requestedReviewer: pr.requestedReviewer,
      asCodeOwner: pr.asCodeOwner,
    })),
  };

  await appendBudgetRun(budgetRun);

  // Compute current SLI
  const budgetRuns = await loadBudgetRuns();
  const sli = computeSLI(budgetRuns, windowStart, now, ctx);

  // Output results
  const minDeadline = getMinDeadline(prsWithDeadlines);
  const hasOverdue = minDeadline && minDeadline < now;

  console.log("\n=== Run Info ===");
  console.log(`Run time: ${now.toISOString()}`);
  if (hasOverdue) {
    console.log(`Overdue since: ${minDeadline.toISOString()}`);
  } else {
    console.log("No overdue PRs.");
  }

  console.log("\n=== Current SLI (30-day rolling window) ===");
  console.log(`Total business minutes: ${sli.totalBusinessMinutes}`);
  console.log(`Good minutes: ${sli.goodMinutes}`);
  console.log(`Bad minutes: ${sli.badMinutes}`);
  console.log(`SLI: ${(sli.sli * 100).toFixed(2)}%`);
  console.log(`Target: ${(config.slo.target * 100).toFixed(0)}%`);
  console.log(`Budget: ${sli.budgetMinutes.toFixed(0)} minutes`);
  console.log(`Budget remaining: ${sli.budgetRemaining.toFixed(0)} minutes`);
  console.log(`Status: ${sli.isMet ? "✓ SLO MET" : "✗ SLO VIOLATED"}`);

  if (prsWithDeadlines.length > 0) {
    console.log("\n=== PRs in Queue ===");
    for (const pr of prsWithDeadlines) {
      const status = pr.isOverdue ? "OVERDUE" : "OK";
      const codeOwnerTag = pr.asCodeOwner ? " [code owner]" : "";
      console.log(
        `[${status}] ${pr.repo}#${pr.number} (${pr.bucket}, ${pr.loc} LOC)`
      );
      console.log(`  Title: ${pr.title}`);
      console.log(`  Requested by: ${pr.requestedReviewer}${codeOwnerTag}`);
      console.log(`  Requested: ${pr.requestedAt.toISOString()}`);
      console.log(`  Deadline: ${pr.deadline.toISOString()}`);
      console.log(`  URL: ${pr.url}`);
    }
  }
}
