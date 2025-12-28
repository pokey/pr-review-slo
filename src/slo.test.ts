import { test, expect, describe } from "bun:test";
import {
  assignBucket,
  getAllowedBusinessDays,
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
    test("assigns small bucket for <200 LOC", () => {
      expect(assignBucket(0, mockConfig)).toBe("small");
      expect(assignBucket(100, mockConfig)).toBe("small");
      expect(assignBucket(199, mockConfig)).toBe("small");
    });

    test("assigns medium bucket for 200-799 LOC", () => {
      expect(assignBucket(200, mockConfig)).toBe("medium");
      expect(assignBucket(500, mockConfig)).toBe("medium");
      expect(assignBucket(799, mockConfig)).toBe("medium");
    });

    test("assigns large bucket for >=800 LOC", () => {
      expect(assignBucket(800, mockConfig)).toBe("large");
      expect(assignBucket(1000, mockConfig)).toBe("large");
      expect(assignBucket(10000, mockConfig)).toBe("large");
    });
  });

  describe("getAllowedBusinessDays", () => {
    test("returns 1 day for small bucket", () => {
      expect(getAllowedBusinessDays("small", mockConfig)).toBe(1);
    });

    test("returns 3 days for medium bucket", () => {
      expect(getAllowedBusinessDays("medium", mockConfig)).toBe(3);
    });

    test("returns 0 days for large bucket", () => {
      expect(getAllowedBusinessDays("large", mockConfig)).toBe(0);
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
    });

    test("computes deadline for small PR", () => {
      const pr = makePR(100, new Date("2025-01-06T10:00:00-08:00")); // Monday
      const result = computeDeadline(pr, mockConfig, mockCtx);

      expect(result.bucket).toBe("small");
      expect(result.deadline.getDay()).toBe(2); // Tuesday
    });

    test("computes deadline for medium PR", () => {
      const pr = makePR(500, new Date("2025-01-06T10:00:00-08:00")); // Monday
      const result = computeDeadline(pr, mockConfig, mockCtx);

      expect(result.bucket).toBe("medium");
      expect(result.deadline.getDay()).toBe(4); // Thursday
    });

    test("marks large PR as large bucket", () => {
      const pr = makePR(1000, new Date("2025-01-06T10:00:00-08:00"));
      const result = computeDeadline(pr, mockConfig, mockCtx);

      expect(result.bucket).toBe("large");
      expect(result.isOverdue).toBe(false); // Large PRs are never overdue
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
      bucket: "small" | "medium" | "large" = "small"
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
