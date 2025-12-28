import { paths, ensureDataDir } from "./config";
import type { BudgetRun, PTOInterval } from "./types";

// Generic JSONL operations
async function appendToJSONL<T>(filePath: string, record: T): Promise<void> {
  await ensureDataDir();
  const file = Bun.file(filePath);
  const line = JSON.stringify(record) + "\n";

  if (await file.exists()) {
    const existing = await file.text();
    await Bun.write(filePath, existing + line);
  } else {
    await Bun.write(filePath, line);
  }
}

async function readJSONL<T>(filePath: string): Promise<T[]> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return [];
  }

  const content = await file.text();
  return content
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

// Budget runs storage
export async function appendBudgetRun(run: BudgetRun): Promise<void> {
  await appendToJSONL(paths.budgetRuns, run);
}

export async function loadBudgetRuns(): Promise<BudgetRun[]> {
  return readJSONL<BudgetRun>(paths.budgetRuns);
}

export async function getLastBudgetRun(): Promise<BudgetRun | null> {
  const runs = await loadBudgetRuns();
  return runs.length > 0 ? runs[runs.length - 1]! : null;
}

// PTO storage
export async function appendPTO(pto: PTOInterval): Promise<void> {
  await appendToJSONL(paths.pto, pto);
}

export async function loadPTOIntervals(): Promise<PTOInterval[]> {
  return readJSONL<PTOInterval>(paths.pto);
}

export async function getActivePTOIntervals(): Promise<PTOInterval[]> {
  const all = await loadPTOIntervals();
  const today = new Date().toISOString().slice(0, 10);

  // Return PTOs that haven't ended yet (or overlap with recent past for calculations)
  return all.filter((pto) => pto.end >= today);
}

// Utility for cleaning up old data (optional, for maintenance)
export async function pruneOldBudgetRuns(keepDays: number): Promise<number> {
  const runs = await loadBudgetRuns();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cutoffStr = cutoff.toISOString();

  const kept = runs.filter((run) => run.runAt >= cutoffStr);
  const pruned = runs.length - kept.length;

  if (pruned > 0) {
    const content = kept.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await Bun.write(paths.budgetRuns, content);
  }

  return pruned;
}

// Get budget runs within a window
export function getBudgetRunsInWindow(
  runs: BudgetRun[],
  windowStart: Date,
  windowEnd: Date
): BudgetRun[] {
  const startStr = windowStart.toISOString();
  const endStr = windowEnd.toISOString();

  return runs.filter((run) => {
    // Run overlaps with window if run's interval overlaps
    const runStart = run.prevRunAt || run.runAt;
    const runEnd = run.runAt;
    return runEnd >= startStr && runStart <= endStr;
  });
}

// Calculate overlapping bad minutes within a window
export function calculateBadMinutesInWindow(
  runs: BudgetRun[],
  windowStart: Date,
  windowEnd: Date,
  countBusinessMinutes: (start: Date, end: Date) => number
): number {
  let totalBadMinutes = 0;

  for (const run of runs) {
    if (!run.badInterval) continue;

    const badStart = new Date(run.badInterval.start);
    const badEnd = new Date(run.badInterval.end);

    // Clamp to window
    const overlapStart = badStart < windowStart ? windowStart : badStart;
    const overlapEnd = badEnd > windowEnd ? windowEnd : badEnd;

    if (overlapStart < overlapEnd) {
      totalBadMinutes += countBusinessMinutes(overlapStart, overlapEnd);
    }
  }

  return totalBadMinutes;
}
