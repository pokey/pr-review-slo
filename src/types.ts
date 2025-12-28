export interface Config {
  github: {
    username: string;
    repos?: string[]; // Optional filter: ["org/repo", "org2/*"]
  };
  businessHours: {
    start: number; // 9 for 9:00
    end: number; // 19 for 19:00
    timezone: string; // e.g., "America/Los_Angeles"
  };
  businessDays: number[]; // 1=Mon, 5=Fri, so [1,2,3,4,5]
  holidayCountryCode: string; // e.g., "US"
  slo: {
    target: number; // 0.90
    windowDays: number; // 30
  };
  sizeBuckets: {
    small: { maxLoc: number; businessDays: number };
    medium: { maxLoc: number; businessDays: number };
  };
}

export interface PR {
  repo: string;
  number: number;
  url: string;
  title: string;
  requestedAt: Date;
  loc: number;
  additions: number;
  deletions: number;
  isDraft: boolean;
}

export interface PRWithDeadline extends PR {
  deadline: Date;
  bucket: "small" | "medium" | "large";
  isOverdue: boolean;
}

export interface BudgetRun {
  type: "budget_run";
  runAt: string; // ISO timestamp
  prevRunAt: string | null;
  intervalBusinessMinutes: number;
  badMinutes: number;
  badInterval: {
    start: string;
    end: string;
  } | null;
  minDeadline: string | null;
  prs: Array<{
    repo: string;
    number: number;
    url: string;
    title: string;
    requestedAt: string;
    loc: number;
    deadline: string;
  }>;
}

export interface PTOInterval {
  type: "pto";
  start: string; // ISO date (YYYY-MM-DD)
  end: string; // ISO date (YYYY-MM-DD)
  addedAt: string;
}

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  countryCode: string;
}

export interface SLIResult {
  goodMinutes: number;
  totalBusinessMinutes: number;
  sli: number;
  budgetMinutes: number;
  badMinutes: number;
  budgetRemaining: number;
  isMet: boolean;
}

export interface ReviewRecommendation {
  mustDoToday: PRWithDeadline[];
  extraCredit: Array<
    PRWithDeadline & {
      savedBadMinutes: number;
      percentOfRemainingBudget: number;
    }
  >;
  projectedBadMinutesIfNoReviews: number;
  histBadMinutes: number;
  budgetMinutes: number;
}
