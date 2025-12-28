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

interface Options {
  reviewHour?: number;
}

export async function getPRsToReviewCommand(options: Options = {}): Promise<void> {
  const config = await loadConfig();
  const now = new Date();
  const reviewHour = options.reviewHour ?? 12; // Default to noon

  console.log("Fetching PRs requesting review...");
  const prs = await fetchInScopePRs(config);
  console.log(`Found ${prs.length} PR(s) requesting review.`);

  if (prs.length === 0) {
    console.log("\nNo PRs to review. Queue is clear!");
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
  console.log(`${prsWithDeadlines.length} PR(s) in scope (excluding large).`);

  if (prsWithDeadlines.length === 0) {
    console.log("\nAll PRs are large (excluded from SLO). No action required.");
    return;
  }

  // Get next review time
  const nextReviewTime = getNextReviewTime(now, reviewHour, ctx);
  console.log(`\nNext scheduled review time: ${nextReviewTime.toISOString()}`);

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
  console.log("\n=== Review Recommendations ===");
  console.log(`Historical bad minutes (30-day window): ${recommendations.histBadMinutes}`);
  console.log(`Budget: ${recommendations.budgetMinutes.toFixed(0)} minutes`);
  console.log(
    `Projected bad if no reviews: ${recommendations.projectedBadMinutesIfNoReviews} minutes`
  );

  const totalProjected =
    recommendations.histBadMinutes +
    recommendations.projectedBadMinutesIfNoReviews;
  const wouldViolate = totalProjected > recommendations.budgetMinutes;

  if (wouldViolate) {
    console.log(
      `\n⚠️  Total projected: ${totalProjected.toFixed(0)} minutes (WOULD EXCEED BUDGET)`
    );
  } else {
    console.log(
      `\nTotal projected: ${totalProjected.toFixed(0)} minutes (within budget)`
    );
  }

  // Must-do PRs
  if (recommendations.mustDoToday.length > 0) {
    console.log("\n=== MUST REVIEW TODAY ===");
    console.log(
      "These PRs must be reviewed to avoid exceeding your error budget:\n"
    );

    for (const pr of recommendations.mustDoToday) {
      console.log(`🔴 ${pr.repo}#${pr.number} (${pr.bucket}, ${pr.loc} LOC)`);
      console.log(`   Title: ${pr.title}`);
      console.log(`   Deadline: ${pr.deadline.toISOString()}`);
      console.log(`   URL: ${pr.url}`);
      console.log();
    }
  } else {
    console.log("\n✅ No mandatory reviews today!");
    console.log("You can skip reviewing until the next scheduled time.");
  }

  // Extra credit PRs
  if (recommendations.extraCredit.length > 0) {
    console.log("\n=== EXTRA CREDIT ===");
    console.log(
      "Reviewing these PRs now would save budget but isn't required:\n"
    );

    for (const pr of recommendations.extraCredit) {
      const pctStr = (pr.percentOfRemainingBudget * 100).toFixed(1);
      console.log(`🟡 ${pr.repo}#${pr.number} (${pr.bucket}, ${pr.loc} LOC)`);
      console.log(`   Title: ${pr.title}`);
      console.log(`   Deadline: ${pr.deadline.toISOString()}`);
      console.log(
        `   Saves: ${pr.savedBadMinutes} minutes (${pctStr}% of remaining budget)`
      );
      console.log(`   URL: ${pr.url}`);
      console.log();
    }
  }

  // Summary
  const remainingPRs =
    prsWithDeadlines.length -
    recommendations.mustDoToday.length -
    recommendations.extraCredit.length;

  if (remainingPRs > 0) {
    console.log(
      `\n${remainingPRs} PR(s) can safely wait past the next review time.`
    );
  }
}
