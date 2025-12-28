import { paths } from "./config";
import type { Holiday } from "./types";

const NAGER_DATE_API = "https://date.nager.at/api/v3/PublicHolidays";

export async function fetchHolidays(
  year: number,
  countryCode: string
): Promise<Holiday[]> {
  // Check cache first
  const cacheFile = Bun.file(paths.holidayCache(year));
  if (await cacheFile.exists()) {
    const cached = await cacheFile.json();
    if (cached.countryCode === countryCode) {
      return cached.holidays;
    }
  }

  // Fetch from API
  const url = `${NAGER_DATE_API}/${year}/${countryCode}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch holidays: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as Array<{
    date: string;
    localName: string;
    name: string;
    countryCode: string;
  }>;

  const holidays: Holiday[] = data.map((h) => ({
    date: h.date,
    name: h.name,
    countryCode: h.countryCode,
  }));

  // Cache the result
  await Bun.write(
    paths.holidayCache(year),
    JSON.stringify({ countryCode, holidays }, null, 2)
  );

  return holidays;
}

export async function getHolidaysForRange(
  start: Date,
  end: Date,
  countryCode: string
): Promise<Set<string>> {
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  const holidayDates = new Set<string>();

  for (let year = startYear; year <= endYear; year++) {
    try {
      const holidays = await fetchHolidays(year, countryCode);
      for (const h of holidays) {
        holidayDates.add(h.date);
      }
    } catch (err) {
      console.error(`Warning: Could not fetch holidays for ${year}: ${err}`);
    }
  }

  return holidayDates;
}

export function isHoliday(date: Date, holidays: Set<string>): boolean {
  const dateStr = date.toISOString().slice(0, 10);
  return holidays.has(dateStr);
}
