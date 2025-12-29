import { test, expect, describe, beforeEach } from "bun:test";
import {
  countBusinessMinutes,
  addBusinessDays,
  type BusinessTimeContext,
} from "./business-time";
import type { Config } from "./types";

const mockConfig: Config = {
  github: { username: "testuser" },
  businessHours: {
    start: 9,
    end: 17, // 9-5 for easier testing
    timezone: "America/Los_Angeles",
  },
  businessDays: [1, 2, 3, 4, 5], // Mon-Fri
  holidayCountryCode: "US",
  slo: { target: 0.9, windowDays: 30 },
  sizeBuckets: {
    small: { maxLoc: 200, businessDays: 1 },
    medium: { maxLoc: 800, businessDays: 3 },
  },
};

describe("business-time", () => {
  let ctx: BusinessTimeContext;

  beforeEach(async () => {
    // Create context with no holidays or PTO for predictable tests
    ctx = {
      config: mockConfig,
      holidays: new Set<string>(),
      ptoIntervals: [],
    };
  });

  describe("countBusinessMinutes", () => {
    test("returns 0 for same start and end", () => {
      const date = new Date("2025-01-06T12:00:00-08:00"); // Monday noon PST
      expect(countBusinessMinutes(date, date, ctx)).toBe(0);
    });

    test("returns 0 for end before start", () => {
      const start = new Date("2025-01-06T12:00:00-08:00");
      const end = new Date("2025-01-06T11:00:00-08:00");
      expect(countBusinessMinutes(start, end, ctx)).toBe(0);
    });

    test("counts minutes within a business day", () => {
      // Monday 10:00 to 11:00 = 60 business minutes
      const start = new Date("2025-01-06T10:00:00-08:00");
      const end = new Date("2025-01-06T11:00:00-08:00");
      expect(countBusinessMinutes(start, end, ctx)).toBe(60);
    });

    test("excludes weekend minutes", () => {
      // Saturday - should be 0
      const start = new Date("2025-01-04T10:00:00-08:00"); // Saturday
      const end = new Date("2025-01-04T11:00:00-08:00");
      expect(countBusinessMinutes(start, end, ctx)).toBe(0);
    });

    test("excludes outside-business-hours minutes", () => {
      // Monday 6:00-7:00 AM - before business hours
      const start = new Date("2025-01-06T06:00:00-08:00");
      const end = new Date("2025-01-06T07:00:00-08:00");
      expect(countBusinessMinutes(start, end, ctx)).toBe(0);
    });

    test("handles partial day correctly", () => {
      // Monday 8:00 to 10:00 - only 9:00-10:00 counts (60 minutes)
      const start = new Date("2025-01-06T08:00:00-08:00");
      const end = new Date("2025-01-06T10:00:00-08:00");
      expect(countBusinessMinutes(start, end, ctx)).toBe(60);
    });

    test("counts minutes spanning multiple business days", () => {
      // Monday 3:00 PM to Tuesday 11:00 AM
      // Monday: 15:00-17:00 = 2 hours = 120 minutes
      // Tuesday: 09:00-11:00 = 2 hours = 120 minutes
      // Total: 240 minutes
      const start = new Date("2025-01-06T15:00:00-08:00"); // Monday 3 PM
      const end = new Date("2025-01-07T11:00:00-08:00"); // Tuesday 11 AM
      expect(countBusinessMinutes(start, end, ctx)).toBe(240);
    });
  });

  describe("addBusinessDays", () => {
    test("adds one business day on Monday", () => {
      const monday = new Date("2025-01-06T18:00:00.000Z"); // Monday 10 AM PST
      const result = addBusinessDays(monday, 1, ctx);
      // Should be Tuesday at same time (10 AM PST = 18:00 UTC)
      expect(result.toISOString()).toBe("2025-01-07T18:00:00.000Z");
    });

    test("skips weekend when adding business days", () => {
      const friday = new Date("2025-01-10T18:00:00.000Z"); // Friday 10 AM PST
      const result = addBusinessDays(friday, 1, ctx);
      // Should be Monday at same time (skips Saturday and Sunday)
      expect(result.toISOString()).toBe("2025-01-13T18:00:00.000Z");
    });

    test("adds multiple business days", () => {
      const monday = new Date("2025-01-06T18:00:00.000Z"); // Monday 10 AM PST
      const result = addBusinessDays(monday, 3, ctx);
      // Monday + 3 business days = Thursday at same time
      expect(result.toISOString()).toBe("2025-01-09T18:00:00.000Z");
    });

    test("skips holidays when adding business days", () => {
      // MLK Day 2025 is Monday Jan 20
      const ctxWithHoliday: BusinessTimeContext = {
        ...ctx,
        holidays: new Set(["2025-01-20"]),
      };
      const friday = new Date("2025-01-17T18:00:00.000Z"); // Friday Jan 17
      const result = addBusinessDays(friday, 1, ctxWithHoliday);
      // Should skip weekend (Sat/Sun) AND Monday holiday, land on Tuesday Jan 21
      expect(result.toISOString()).toBe("2025-01-21T18:00:00.000Z");
    });

    test("skips PTO when adding business days", () => {
      const ctxWithPTO: BusinessTimeContext = {
        ...ctx,
        ptoIntervals: [
          {
            type: "pto",
            start: "2025-01-07",
            end: "2025-01-08",
            addedAt: new Date().toISOString(),
          },
        ],
      };
      const monday = new Date("2025-01-06T18:00:00.000Z"); // Monday Jan 6
      const result = addBusinessDays(monday, 1, ctxWithPTO);
      // Should skip Tuesday and Wednesday (PTO), land on Thursday Jan 9
      expect(result.toISOString()).toBe("2025-01-09T18:00:00.000Z");
    });
  });

  describe("with PTO", () => {
    test("excludes PTO days from business minutes", async () => {
      const ctxWithPTO: BusinessTimeContext = {
        ...ctx,
        ptoIntervals: [
          {
            type: "pto",
            start: "2025-01-06",
            end: "2025-01-06",
            addedAt: new Date().toISOString(),
          },
        ],
      };

      // Monday 10:00 to 11:00 - but Monday is PTO
      const start = new Date("2025-01-06T10:00:00-08:00");
      const end = new Date("2025-01-06T11:00:00-08:00");
      expect(countBusinessMinutes(start, end, ctxWithPTO)).toBe(0);
    });
  });

  describe("with holidays", () => {
    test("excludes holidays from business minutes", async () => {
      const ctxWithHoliday: BusinessTimeContext = {
        ...ctx,
        holidays: new Set(["2025-01-06"]), // Monday is a holiday
      };

      // Monday 10:00 to 11:00 - but Monday is a holiday
      const start = new Date("2025-01-06T10:00:00-08:00");
      const end = new Date("2025-01-06T11:00:00-08:00");
      expect(countBusinessMinutes(start, end, ctxWithHoliday)).toBe(0);
    });
  });
});
