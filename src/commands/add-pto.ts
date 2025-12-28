import { appendPTO, loadPTOIntervals } from "../storage";
import type { PTOInterval } from "../types";

interface Options {
  from: string;
  to: string;
}

function parseDate(dateStr: string): string {
  // Accept YYYY-MM-DD format
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(
      `Invalid date format: ${dateStr}. Expected YYYY-MM-DD (e.g., 2025-12-25)`
    );
  }

  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00`);

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateStr}`);
  }

  return `${year}-${month}-${day}`;
}

export async function addPTOCommand(options: Options): Promise<void> {
  const fromDate = parseDate(options.from);
  const toDate = parseDate(options.to);

  if (fromDate > toDate) {
    throw new Error(
      `Invalid date range: --from (${fromDate}) must be before --to (${toDate})`
    );
  }

  const pto: PTOInterval = {
    type: "pto",
    start: fromDate,
    end: toDate,
    addedAt: new Date().toISOString(),
  };

  await appendPTO(pto);

  console.log(`Added PTO interval: ${fromDate} to ${toDate}`);

  // Show all active PTO intervals
  const all = await loadPTOIntervals();
  const today = new Date().toISOString().slice(0, 10);
  const active = all.filter((p) => p.end >= today);

  if (active.length > 0) {
    console.log("\nActive/Future PTO intervals:");
    for (const p of active) {
      console.log(`  ${p.start} to ${p.end}`);
    }
  }
}

export async function listPTOCommand(): Promise<void> {
  const all = await loadPTOIntervals();
  const today = new Date().toISOString().slice(0, 10);

  if (all.length === 0) {
    console.log("No PTO intervals recorded.");
    return;
  }

  console.log("All PTO intervals:");
  for (const p of all) {
    const status = p.end < today ? "(past)" : "(active/future)";
    console.log(`  ${p.start} to ${p.end} ${status}`);
  }
}
