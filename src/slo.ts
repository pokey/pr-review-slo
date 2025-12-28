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
import { calculateBadMinutesInWindow, getBudgetRunsInWindow } from "./storage";

export function assignBucket(
  loc: number,
  config: Config
): "small" | "medium" | "large" {
  if (loc < config.sizeBuckets.small.maxLoc) {
    return "small";
  }
  if (loc < config.sizeBuckets.medium.maxLoc) {
    return "medium";
  }
  return "large";
}

export function getAllowedBusinessDays(
  bucket: "small" | "medium" | "large",
  config: Config
): number {
  if (bucket === "small") return config.sizeBuckets.small.businessDays;
  if (bucket === "medium") return config.sizeBuckets.medium.businessDays;
  return 0; // Large PRs are excluded
}

export function computeDeadline(
  pr: PR,
  config: Config,
  ctx: BusinessTimeContext
): PRWithDeadline {
  const bucket = assignBucket(pr.loc, config);
  const businessDays = getAllowedBusinessDays(bucket, config);

  const deadline =
    bucket === "large"
      ? new Date(8640000000000000) // Max date for large PRs (effectively excluded)
      : addBusinessDays(pr.requestedAt, businessDays, ctx);

  const now = new Date();
  const isOverdue = bucket !== "large" && now > deadline;

  return {
    ...pr,
    bucket,
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
    .filter((pr) => pr.bucket !== "large") // Exclude large PRs from SLO
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime()); // Sort by deadline
}

export function getMinDeadline(prs: PRWithDeadline[]): Date | null {
  if (prs.length === 0) return null;
  return prs[0]!.deadline; // Already sorted by deadline
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

  const badMinutes = calculateBadMinutesInWindow(
    budgetRuns,
    windowStart,
    windowEnd,
    (start, end) => countBusinessMinutes(start, end, ctx)
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

export function computeErrorBudgetContribution(
  prs: PRWithDeadline[],
  prevRunAt: Date | null,
  now: Date,
  ctx: BusinessTimeContext
): {
  badMinutes: number;
  badInterval: { start: Date; end: Date } | null;
  intervalBusinessMinutes: number;
} {
  const intervalStart = prevRunAt || now;
  const intervalBusinessMinutes = countBusinessMinutes(intervalStart, now, ctx);

  const minDeadline = getMinDeadline(prs);

  // If no PRs or nothing is overdue
  if (!minDeadline || minDeadline >= now) {
    return {
      badMinutes: 0,
      badInterval: null,
      intervalBusinessMinutes,
    };
  }

  // Something is overdue
  const badStart = prevRunAt && prevRunAt > minDeadline ? prevRunAt : minDeadline;
  const badMinutes = countBusinessMinutes(badStart, now, ctx);

  return {
    badMinutes,
    badInterval: { start: badStart, end: now },
    intervalBusinessMinutes,
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

  const runsInWindow = getBudgetRunsInWindow(
    budgetRuns,
    windowStart,
    nextReviewTime
  );
  const histBadMinutes = calculateBadMinutesInWindow(
    runsInWindow,
    windowStart,
    nextReviewTime,
    (start, end) => countBusinessMinutes(start, end, ctx)
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
