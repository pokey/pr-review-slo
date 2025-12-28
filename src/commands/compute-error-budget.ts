import { loadConfig } from "../config";
import { fetchInScopePRs } from "../github";
import {
  createBusinessTimeContext,
  countBusinessMinutes,
} from "../business-time";
import {
  loadPTOIntervals,
  loadBudgetRuns,
  getLastBudgetRun,
  appendBudgetRun,
} from "../storage";
import {
  computePRDeadlines,
  computeErrorBudgetContribution,
  computeSLI,
  getMinDeadline,
} from "../slo";
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

  // Compute deadlines for all PRs
  const prsWithDeadlines = computePRDeadlines(prs, config, ctx);
  console.log(`${prsWithDeadlines.length} PR(s) in scope (excluding large).`);

  // Get last run
  const lastRun = await getLastBudgetRun();
  const prevRunAt = lastRun ? new Date(lastRun.runAt) : null;

  // Compute error budget contribution for this interval
  const contribution = computeErrorBudgetContribution(
    prsWithDeadlines,
    prevRunAt,
    now,
    ctx
  );

  const minDeadline = getMinDeadline(prsWithDeadlines);

  // Create and store the budget run
  const budgetRun: BudgetRun = {
    type: "budget_run",
    runAt: now.toISOString(),
    prevRunAt: prevRunAt?.toISOString() || null,
    intervalBusinessMinutes: contribution.intervalBusinessMinutes,
    badMinutes: contribution.badMinutes,
    badInterval: contribution.badInterval
      ? {
          start: contribution.badInterval.start.toISOString(),
          end: contribution.badInterval.end.toISOString(),
        }
      : null,
    minDeadline: minDeadline?.toISOString() || null,
    prs: prsWithDeadlines.map((pr) => ({
      repo: pr.repo,
      number: pr.number,
      url: pr.url,
      title: pr.title,
      requestedAt: pr.requestedAt.toISOString(),
      loc: pr.loc,
      deadline: pr.deadline.toISOString(),
    })),
  };

  await appendBudgetRun(budgetRun);

  // Compute current SLI
  const budgetRuns = await loadBudgetRuns();
  const sli = computeSLI(budgetRuns, windowStart, now, ctx);

  // Output results
  console.log("\n=== Error Budget Contribution ===");
  console.log(`Run time: ${now.toISOString()}`);
  if (prevRunAt) {
    console.log(`Previous run: ${prevRunAt.toISOString()}`);
    console.log(
      `Interval business minutes: ${contribution.intervalBusinessMinutes}`
    );
  } else {
    console.log("First run (no previous interval)");
  }

  if (contribution.badMinutes > 0) {
    console.log(`\nBad minutes this interval: ${contribution.badMinutes}`);
    console.log(
      `Bad interval: ${contribution.badInterval!.start.toISOString()} to ${contribution.badInterval!.end.toISOString()}`
    );
  } else {
    console.log("\nNo bad minutes this interval.");
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
      console.log(
        `[${status}] ${pr.repo}#${pr.number} (${pr.bucket}, ${pr.loc} LOC)`
      );
      console.log(`  Title: ${pr.title}`);
      console.log(`  Requested: ${pr.requestedAt.toISOString()}`);
      console.log(`  Deadline: ${pr.deadline.toISOString()}`);
      console.log(`  URL: ${pr.url}`);
    }
  }
}
