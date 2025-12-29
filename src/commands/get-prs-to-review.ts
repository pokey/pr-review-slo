import { loadConfig } from "../config";
import { fetchInScopePRs } from "../github";
import {
  createBusinessTimeContext,
  getNextReviewTime,
} from "../business-time";
import { loadPTOIntervals, loadBudgetRuns } from "../storage";
import {
  computePRDeadlines,
  computeReviewRecommendations,
} from "../slo";
import pc from "picocolors";

interface Options {
  reviewHour?: number;
}

export async function getPRsToReviewCommand(options: Options = {}): Promise<void> {
  const config = await loadConfig();
  const now = new Date();
  const reviewHour = options.reviewHour ?? 12; // Default to noon

  const label = (s: string) => pc.dim(s);
  const heading = (s: string) => pc.bold(pc.cyan(s));

  console.log(pc.dim("Fetching PRs requesting review..."));
  const prs = await fetchInScopePRs(config);
  console.log(pc.dim(`Found ${prs.length} PR(s) requesting review.`));

  if (prs.length === 0) {
    console.log();
    console.log(pc.green("No PRs to review. Queue is clear!"));
    return;
  }

  // Load PTO intervals
  const ptoIntervals = await loadPTOIntervals();

  // Create business time context
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 7); // Look ahead a week for planning
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - config.slo.windowDays);

  const ctx = await createBusinessTimeContext(
    config,
    ptoIntervals,
    windowStart,
    windowEnd
  );

  // Compute deadlines for all PRs
  const prsWithDeadlines = computePRDeadlines(prs, config, ctx);
  console.log(pc.dim(`${prsWithDeadlines.length} PR(s) in scope (excluding large).`));

  if (prsWithDeadlines.length === 0) {
    console.log();
    console.log(pc.green("All PRs are large (excluded from SLO). No action required."));
    return;
  }

  // Get next review time
  const nextReviewTime = getNextReviewTime(now, reviewHour, ctx);
  console.log();
  console.log(`${label("Next review")} ${pc.white(nextReviewTime.toISOString())}`);

  // Load budget runs and compute recommendations
  const budgetRuns = await loadBudgetRuns();
  const recommendations = computeReviewRecommendations(
    prsWithDeadlines,
    budgetRuns,
    now,
    nextReviewTime,
    ctx
  );

  // Output results
  console.log();
  console.log(heading("Budget Status"));
  console.log();
  console.log(`${label("Historical bad")}  ${pc.yellow(recommendations.histBadMinutes.toString())} min`);
  console.log(`${label("Budget")}          ${pc.white(recommendations.budgetMinutes.toFixed(0))} min`);
  console.log(`${label("Projected bad")}   ${pc.yellow(recommendations.projectedBadMinutesIfNoReviews.toString())} min ${pc.dim("(if no reviews)")}`);

  const totalProjected =
    recommendations.histBadMinutes +
    recommendations.projectedBadMinutesIfNoReviews;
  const wouldViolate = totalProjected > recommendations.budgetMinutes;

  console.log();
  if (wouldViolate) {
    console.log(pc.bgRed(pc.white(` Total: ${totalProjected.toFixed(0)} min — EXCEEDS BUDGET `)));
  } else {
    console.log(pc.bgGreen(pc.black(` Total: ${totalProjected.toFixed(0)} min — within budget `)));
  }

  // Must-do PRs
  if (recommendations.mustDoToday.length > 0) {
    console.log();
    console.log(pc.bold(pc.red("MUST REVIEW TODAY")));
    console.log(pc.dim("These PRs must be reviewed to stay within budget:"));
    console.log();

    for (const pr of recommendations.mustDoToday) {
      console.log(`${pc.red("●")} ${pc.bold(`${pr.repo}#${pr.number}`)} ${pc.dim(`(${pr.bucket}, ${pr.loc} LOC)`)}`);
      console.log(`  ${pr.title}`);
      console.log(`  ${label("Deadline")} ${pc.red(pr.deadline.toISOString())}`);
      console.log(`  ${pc.dim(pr.url)}`);
      console.log();
    }
  } else {
    console.log();
    console.log(pc.bgGreen(pc.black(" ✓ No mandatory reviews today ")));
    console.log(pc.dim("You can skip reviewing until the next scheduled time."));
  }

  // Extra credit PRs
  if (recommendations.extraCredit.length > 0) {
    console.log();
    console.log(pc.bold(pc.yellow("EXTRA CREDIT")));
    console.log(pc.dim("Reviewing these would save budget but isn't required:"));
    console.log();

    for (const pr of recommendations.extraCredit) {
      const pctStr = (pr.percentOfRemainingBudget * 100).toFixed(1);
      console.log(`${pc.yellow("●")} ${pc.bold(`${pr.repo}#${pr.number}`)} ${pc.dim(`(${pr.bucket}, ${pr.loc} LOC)`)}`);
      console.log(`  ${pr.title}`);
      console.log(`  ${label("Deadline")} ${pc.white(pr.deadline.toISOString())}`);
      console.log(`  ${label("Saves")}    ${pc.green(pr.savedBadMinutes + " min")} ${pc.dim(`(${pctStr}% of budget)`)}`);
      console.log(`  ${pc.dim(pr.url)}`);
      console.log();
    }
  }

  // Summary
  const remainingPRs =
    prsWithDeadlines.length -
    recommendations.mustDoToday.length -
    recommendations.extraCredit.length;

  if (remainingPRs > 0) {
    console.log(pc.dim(`${remainingPRs} PR(s) can safely wait past the next review time.`));
  }
}
