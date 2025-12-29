import type {
  Config,
  PR,
  PRWithDeadline,
  BudgetRun,
  SLIResult,
  ReviewRecommendation,
} from "./types";
import {
  type BusinessTimeContext,
  addBusinessDays,
  countBusinessMinutes,
  getTotalBusinessMinutesInWindow,
} from "./business-time";

/** Get buckets sorted by maxLoc ascending */
export function getSortedBuckets(config: Config): Array<[string, { maxLoc: number; businessDays: number }]> {
  return Object.entries(config.sizeBuckets).sort(([, a], [, b]) => a.maxLoc - b.maxLoc);
}

/** Assign a PR to a bucket based on LOC. Returns null if PR exceeds all buckets (excluded from SLO). */
export function assignBucket(
  loc: number,
  config: Config
): string | null {
  const sortedBuckets = getSortedBuckets(config);
  for (const [name, bucket] of sortedBuckets) {
    if (loc < bucket.maxLoc) {
      return name;
    }
  }
  return null; // Exceeds all buckets, excluded from SLO
}

export function getAllowedBusinessDays(
  bucket: string | null,
  config: Config
): number {
  if (bucket === null) return 0; // Excluded PRs
  const bucketConfig = config.sizeBuckets[bucket];
  return bucketConfig?.businessDays ?? 0;
}

export function computeDeadline(
  pr: PR,
  config: Config,
  ctx: BusinessTimeContext
): PRWithDeadline {
  const bucket = assignBucket(pr.loc, config);
  const businessDays = getAllowedBusinessDays(bucket, config);

  const deadline =
    bucket === null
      ? new Date(8640000000000000) // Max date for excluded PRs
      : addBusinessDays(pr.requestedAt, businessDays, ctx);

  const now = new Date();
  const isOverdue = bucket !== null && now > deadline;

  return {
    ...pr,
    bucket: bucket ?? "excluded",
    deadline,
    isOverdue,
  };
}

export function computePRDeadlines(
  prs: PR[],
  config: Config,
  ctx: BusinessTimeContext
): PRWithDeadline[] {
  return prs
    .map((pr) => computeDeadline(pr, config, ctx))
    .filter((pr) => pr.bucket !== "excluded") // Exclude PRs that exceed all buckets
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime()); // Sort by deadline
}

export function getMinDeadline(prs: PRWithDeadline[]): Date | null {
  if (prs.length === 0) return null;
  return prs[0]!.deadline; // Already sorted by deadline
}

/** Compute bad minutes from budget runs within a window, calculating deadlines on the fly */
export function computeBadMinutesInWindow(
  budgetRuns: BudgetRun[],
  windowStart: Date,
  windowEnd: Date,
  ctx: BusinessTimeContext
): number {
  let badMinutes = 0;
  const sortedRuns = [...budgetRuns]
    .filter((run) => {
      const runAt = new Date(run.runAt);
      return runAt >= windowStart && runAt <= windowEnd;
    })
    .sort((a, b) => new Date(a.runAt).getTime() - new Date(b.runAt).getTime());

  for (let i = 0; i < sortedRuns.length; i++) {
    const run = sortedRuns[i]!;
    const runAt = new Date(run.runAt);
    const prevRunAt = i > 0 ? new Date(sortedRuns[i - 1]!.runAt) : null;

    // Compute min deadline for PRs in this run (excluding those that exceed all buckets)
    let minDeadline: Date | null = null;
    for (const pr of run.prs) {
      const bucket = assignBucket(pr.loc, ctx.config);
      // Skip PRs that are too large (bucket === null means exceeds all size buckets)
      if (bucket === null) continue;

      const deadline = addBusinessDays(
        new Date(pr.requestedAt),
        getAllowedBusinessDays(bucket, ctx.config),
        ctx
      );

      // Only count if not yet reviewed at this run time
      if (pr.reviewedAt && new Date(pr.reviewedAt) <= runAt) continue;

      if (!minDeadline || deadline < minDeadline) {
        minDeadline = deadline;
      }
    }

    // If something was overdue at this run
    if (minDeadline && minDeadline < runAt) {
      const badStart =
        prevRunAt && prevRunAt > minDeadline ? prevRunAt : minDeadline;
      const badEnd = runAt;

      // Clamp to window
      const overlapStart = badStart < windowStart ? windowStart : badStart;
      const overlapEnd = badEnd > windowEnd ? windowEnd : badEnd;

      if (overlapStart < overlapEnd) {
        badMinutes += countBusinessMinutes(overlapStart, overlapEnd, ctx);
      }
    }
  }

  return badMinutes;
}

export function computeSLI(
  budgetRuns: BudgetRun[],
  windowStart: Date,
  windowEnd: Date,
  ctx: BusinessTimeContext
): SLIResult {
  const totalBusinessMinutes = getTotalBusinessMinutesInWindow(
    windowStart,
    windowEnd,
    ctx
  );

  const badMinutes = computeBadMinutesInWindow(
    budgetRuns,
    windowStart,
    windowEnd,
    ctx
  );

  const goodMinutes = totalBusinessMinutes - badMinutes;
  const sli = totalBusinessMinutes > 0 ? goodMinutes / totalBusinessMinutes : 1;
  const budgetMinutes = totalBusinessMinutes * (1 - ctx.config.slo.target);
  const budgetRemaining = budgetMinutes - badMinutes;
  const isMet = sli >= ctx.config.slo.target;

  return {
    goodMinutes,
    totalBusinessMinutes,
    sli,
    budgetMinutes,
    badMinutes,
    budgetRemaining,
    isMet,
  };
}

export function computeReviewRecommendations(
  prs: PRWithDeadline[],
  budgetRuns: BudgetRun[],
  now: Date,
  nextReviewTime: Date,
  ctx: BusinessTimeContext
): ReviewRecommendation {
  // Compute historical bad minutes for the window at next review time
  const windowStart = new Date(nextReviewTime);
  windowStart.setDate(windowStart.getDate() - ctx.config.slo.windowDays);

  const histBadMinutes = computeBadMinutesInWindow(
    budgetRuns,
    windowStart,
    nextReviewTime,
    ctx
  );

  const totalBusinessMinutes = getTotalBusinessMinutesInWindow(
    windowStart,
    nextReviewTime,
    ctx
  );
  const budgetMinutes = totalBusinessMinutes * (1 - ctx.config.slo.target);

  // Sort PRs by deadline
  const sortedPRs = [...prs].sort(
    (a, b) => a.deadline.getTime() - b.deadline.getTime()
  );

  // Calculate projected bad minutes if no reviews
  const minDeadline = getMinDeadline(sortedPRs);
  let projectedBadMinutesIfNoReviews = 0;
  if (minDeadline && minDeadline < nextReviewTime) {
    const badStart = now > minDeadline ? now : minDeadline;
    projectedBadMinutesIfNoReviews = countBusinessMinutes(
      badStart,
      nextReviewTime,
      ctx
    );
  }

  // Find must-do PRs
  const mustDoToday: PRWithDeadline[] = [];
  const extraCredit: ReviewRecommendation["extraCredit"] = [];

  let remainingPRs = [...sortedPRs];

  while (remainingPRs.length > 0) {
    const nextMinDeadline = getMinDeadline(remainingPRs);
    if (!nextMinDeadline) break;

    // Calculate projected bad if we don't review this PR
    let projBad = 0;
    if (nextMinDeadline < nextReviewTime) {
      const badStart = now > nextMinDeadline ? now : nextMinDeadline;
      projBad = countBusinessMinutes(badStart, nextReviewTime, ctx);
    }

    const totalBadIfNoReview = histBadMinutes + projBad;

    if (totalBadIfNoReview > budgetMinutes) {
      // This PR is mandatory
      mustDoToday.push(remainingPRs[0]!);
      remainingPRs = remainingPRs.slice(1);
    } else {
      // We can stop - remaining PRs are optional
      break;
    }
  }

  // Calculate extra credit for remaining PRs
  for (let i = 0; i < remainingPRs.length; i++) {
    const pr = remainingPRs[i]!;

    if (pr.deadline >= nextReviewTime) {
      // PR won't become overdue before next review, no urgency
      continue;
    }

    // Calculate saved minutes if we review up to and including this PR
    const prsAfterThis = remainingPRs.slice(i + 1);
    const nextDeadlineAfterThis = getMinDeadline(prsAfterThis);

    let projBadAfterReviewing = 0;
    if (nextDeadlineAfterThis && nextDeadlineAfterThis < nextReviewTime) {
      const badStart =
        now > nextDeadlineAfterThis ? now : nextDeadlineAfterThis;
      projBadAfterReviewing = countBusinessMinutes(
        badStart,
        nextReviewTime,
        ctx
      );
    }

    const savedBadMinutes =
      projectedBadMinutesIfNoReviews - projBadAfterReviewing;
    const remainingBudget = budgetMinutes - histBadMinutes;
    const percentOfRemainingBudget =
      remainingBudget > 0
        ? Math.min(1, Math.max(0, savedBadMinutes / remainingBudget))
        : 0;

    extraCredit.push({
      ...pr,
      savedBadMinutes,
      percentOfRemainingBudget,
    });
  }

  return {
    mustDoToday,
    extraCredit,
    projectedBadMinutesIfNoReviews,
    histBadMinutes,
    budgetMinutes,
  };
}
