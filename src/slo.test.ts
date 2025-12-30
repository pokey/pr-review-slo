import { test, expect, describe } from "bun:test";
import {
  assignBucket,
  computeDeadline,
  getMinDeadline,
} from "./slo";
import type { Config, PR, PRWithDeadline } from "./types";
import type { BusinessTimeContext } from "./business-time";

const mockConfig: Config = {
  github: { username: "testuser" },
  businessHours: {
    start: 9,
    end: 17,
    timezone: "America/Los_Angeles",
  },
  businessDays: [1, 2, 3, 4, 5],
  holidayCountryCode: "US",
  slo: { target: 0.9, windowDays: 30 },
  sizeBuckets: {
    small: { maxLoc: 200, businessDays: 1 },
    medium: { maxLoc: 800, businessDays: 3 },
  },
};

const mockCtx: BusinessTimeContext = {
  config: mockConfig,
  holidays: new Set<string>(),
  ptoIntervals: [],
};

describe("slo", () => {
  describe("assignBucket", () => {
    const makePR = (loc: number, asCodeOwner = false, requestedReviewer = "someone") =>
      ({ loc, asCodeOwner, requestedReviewer });

    test("assigns small bucket for <200 LOC", () => {
      expect(assignBucket(makePR(0), mockConfig)?.[0]).toBe("small");
      expect(assignBucket(makePR(100), mockConfig)?.[0]).toBe("small");
      expect(assignBucket(makePR(199), mockConfig)?.[0]).toBe("small");
    });

    test("assigns medium bucket for 200-799 LOC", () => {
      expect(assignBucket(makePR(200), mockConfig)?.[0]).toBe("medium");
      expect(assignBucket(makePR(500), mockConfig)?.[0]).toBe("medium");
      expect(assignBucket(makePR(799), mockConfig)?.[0]).toBe("medium");
    });

    test("returns null for >=800 LOC (exceeds all buckets)", () => {
      expect(assignBucket(makePR(800), mockConfig)).toBeNull();
      expect(assignBucket(makePR(1000), mockConfig)).toBeNull();
    });

    test("returns bucket with minimum businessDays when multiple match", () => {
      const configWithFilters: Config = {
        ...mockConfig,
        sizeBuckets: {
          small: { maxLoc: 200, businessDays: 1 },
          medium: { maxLoc: 800, businessDays: 3 },
          "code-owner-urgent": { maxLoc: 800, businessDays: 0.5, asCodeOwner: true },
        },
      };

      // Code owner review should get code-owner-urgent (0.5 days) not small (1 day)
      const result = assignBucket(makePR(100, true), configWithFilters);
      expect(result?.[0]).toBe("code-owner-urgent");
      expect(result?.[1].businessDays).toBe(0.5);
    });

    test("filters by requestedReviewer", () => {
      const configWithFilters: Config = {
        ...mockConfig,
        sizeBuckets: {
          small: { maxLoc: 200, businessDays: 1 },
          "team-urgent": { maxLoc: 500, businessDays: 0.5, requestedReviewer: "core-team" },
        },
      };

      // core-team reviewer should get team-urgent
      expect(assignBucket(makePR(100, false, "core-team"), configWithFilters)?.[0]).toBe("team-urgent");
      // other reviewers should get small
      expect(assignBucket(makePR(100, false, "someone-else"), configWithFilters)?.[0]).toBe("small");
    });

    test("respects LOC limit even with matching filters", () => {
      const configWithFilters: Config = {
        ...mockConfig,
        sizeBuckets: {
          medium: { maxLoc: 800, businessDays: 3 },
          "team-urgent": { maxLoc: 500, businessDays: 0.5, requestedReviewer: "core-team" },
        },
      };

      // PR too large for team-urgent should fall back to medium
      expect(assignBucket(makePR(600, false, "core-team"), configWithFilters)?.[0]).toBe("medium");
    });

    test("does not match bucket when asCodeOwner filter doesn't match", () => {
      const configWithFilters: Config = {
        ...mockConfig,
        sizeBuckets: {
          small: { maxLoc: 200, businessDays: 1 },
          "code-owner-urgent": { maxLoc: 800, businessDays: 0.5, asCodeOwner: true },
        },
      };

      // Non-code owner should get small, not code-owner-urgent
      expect(assignBucket(makePR(100, false), configWithFilters)?.[0]).toBe("small");
    });

    test("does not match bucket when requestedReviewer filter doesn't match", () => {
      const configWithFilters: Config = {
        ...mockConfig,
        sizeBuckets: {
          small: { maxLoc: 200, businessDays: 1 },
          "team-urgent": { maxLoc: 500, businessDays: 0.5, requestedReviewer: "core-team" },
        },
      };

      // Different reviewer should get small, not team-urgent
      expect(assignBucket(makePR(100, false, "other-team"), configWithFilters)?.[0]).toBe("small");
    });

    test("returns null when no buckets match due to filters", () => {
      const configWithFilters: Config = {
        ...mockConfig,
        sizeBuckets: {
          "code-owner-only": { maxLoc: 800, businessDays: 1, asCodeOwner: true },
        },
      };

      // Non-code owner PR has no matching bucket
      expect(assignBucket(makePR(100, false), configWithFilters)).toBeNull();
    });
  });

  describe("computeDeadline", () => {
    const makePR = (loc: number, requestedAt: Date): PR => ({
      repo: "org/repo",
      number: 1,
      url: "https://github.com/org/repo/pull/1",
      title: "Test PR",
      requestedAt,
      loc,
      additions: loc / 2,
      deletions: loc / 2,
      isDraft: false,
      requestedReviewer: "testuser",
      asCodeOwner: false,
    });

    test("computes deadline for small PR", () => {
      const pr = makePR(100, new Date("2025-01-06T18:00:00.000Z")); // Monday 10 AM PST
      const result = computeDeadline(pr, mockConfig, mockCtx);

      expect(result.bucket).toBe("small");
      // Small PR = 1 business day, so Tuesday at same time
      expect(result.deadline.toISOString()).toBe("2025-01-07T18:00:00.000Z");
    });

    test("computes deadline for medium PR", () => {
      const pr = makePR(500, new Date("2025-01-06T18:00:00.000Z")); // Monday 10 AM PST
      const result = computeDeadline(pr, mockConfig, mockCtx);

      expect(result.bucket).toBe("medium");
      // Medium PR = 3 business days, so Thursday at same time
      expect(result.deadline.toISOString()).toBe("2025-01-09T18:00:00.000Z");
    });

    test("marks excluded PR that exceeds all buckets", () => {
      const pr = makePR(1000, new Date("2025-01-06T10:00:00-08:00"));
      const result = computeDeadline(pr, mockConfig, mockCtx);

      expect(result.bucket).toBeNull();
      expect(result.isOverdue).toBe(false); // Excluded PRs are never overdue
    });

    test("correctly identifies overdue PR", () => {
      // Request from a week ago
      const pr = makePR(100, new Date("2024-12-30T10:00:00-08:00")); // Week ago
      const result = computeDeadline(pr, mockConfig, mockCtx);

      expect(result.isOverdue).toBe(true);
    });

    test("correctly identifies non-overdue PR", () => {
      // Request from just now
      const now = new Date();
      const pr = makePR(100, now);
      const result = computeDeadline(pr, mockConfig, mockCtx);

      expect(result.isOverdue).toBe(false);
    });
  });

  describe("getMinDeadline", () => {
    const makePRWithDeadline = (
      deadline: Date,
      bucket: string | null = "small"
    ): PRWithDeadline => ({
      repo: "org/repo",
      number: 1,
      url: "https://github.com/org/repo/pull/1",
      title: "Test PR",
      requestedAt: new Date(),
      loc: 100,
      additions: 50,
      deletions: 50,
      isDraft: false,
      requestedReviewer: "testuser",
      asCodeOwner: false,
      deadline,
      bucket,
      isOverdue: false,
    });

    test("returns null for empty array", () => {
      expect(getMinDeadline([])).toBeNull();
    });

    test("returns the earliest deadline", () => {
      const prs = [
        makePRWithDeadline(new Date("2025-01-10")),
        makePRWithDeadline(new Date("2025-01-05")),
        makePRWithDeadline(new Date("2025-01-15")),
      ];
      // Sort by deadline first (as computePRDeadlines does)
      prs.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());

      const result = getMinDeadline(prs);
      expect(result?.toISOString()).toContain("2025-01-05");
    });
  });
});
