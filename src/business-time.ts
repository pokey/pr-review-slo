import type { Config, PTOInterval } from "./types";
import { getHolidaysForRange, isHoliday } from "./holidays";

export interface BusinessTimeContext {
  config: Config;
  holidays: Set<string>;
  ptoIntervals: PTOInterval[];
}

export async function createBusinessTimeContext(
  config: Config,
  ptoIntervals: PTOInterval[],
  startDate: Date,
  endDate: Date
): Promise<BusinessTimeContext> {
  const holidays = await getHolidaysForRange(
    startDate,
    endDate,
    config.holidayCountryCode
  );

  return { config, holidays, ptoIntervals };
}

function getTimezoneOffset(date: Date, timezone: string): number {
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzDate = new Date(date.toLocaleString("en-US", { timeZone: timezone }));
  return (utcDate.getTime() - tzDate.getTime()) / 60000;
}

function toTimezone(date: Date, timezone: string): Date {
  return new Date(date.toLocaleString("en-US", { timeZone: timezone }));
}

function isBusinessDay(date: Date, ctx: BusinessTimeContext): boolean {
  const tzDate = toTimezone(date, ctx.config.businessHours.timezone);
  const dayOfWeek = tzDate.getDay() || 7; // Convert Sunday=0 to 7

  // Check if it's a configured business day
  if (!ctx.config.businessDays.includes(dayOfWeek)) {
    return false;
  }

  // Check if it's a holiday
  if (isHoliday(tzDate, ctx.holidays)) {
    return false;
  }

  return true;
}

function isPTO(date: Date, ptoIntervals: PTOInterval[]): boolean {
  const dateStr = date.toISOString().slice(0, 10);

  for (const pto of ptoIntervals) {
    if (dateStr >= pto.start && dateStr <= pto.end) {
      return true;
    }
  }

  return false;
}

function isBusinessMinute(minute: Date, ctx: BusinessTimeContext): boolean {
  if (!isBusinessDay(minute, ctx)) {
    return false;
  }

  const tzDate = toTimezone(minute, ctx.config.businessHours.timezone);
  const hour = tzDate.getHours();
  const { start, end } = ctx.config.businessHours;

  if (hour < start || hour >= end) {
    return false;
  }

  // Check PTO
  if (isPTO(minute, ctx.ptoIntervals)) {
    return false;
  }

  return true;
}

export function countBusinessMinutes(
  start: Date,
  end: Date,
  ctx: BusinessTimeContext
): number {
  if (start >= end) return 0;

  const { start: businessStart, end: businessEnd } = ctx.config.businessHours;
  const minutesPerBusinessDay = (businessEnd - businessStart) * 60;
  const tz = ctx.config.businessHours.timezone;

  let count = 0;

  // Get time components in the target timezone
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const startDateStr = dateFormatter.format(start);
  const endDateStr = dateFormatter.format(end);
  const startTime = timeFormatter.format(start).split(":");
  const endTime = timeFormatter.format(end).split(":");
  const startHour = parseInt(startTime[0]!, 10);
  const startMinute = parseInt(startTime[1]!, 10);
  const endHour = parseInt(endTime[0]!, 10);
  const endMinute = parseInt(endTime[1]!, 10);

  // Helper to get business minutes for a partial day
  function getBusinessMinutesForDay(
    date: Date,
    fromHour: number,
    fromMinute: number,
    toHour: number,
    toMinute: number
  ): number {
    if (!isBusinessDay(date, ctx) || isPTO(date, ctx.ptoIntervals)) {
      return 0;
    }

    const effectiveStart = Math.max(fromHour * 60 + fromMinute, businessStart * 60);
    const effectiveEnd = Math.min(toHour * 60 + toMinute, businessEnd * 60);

    return Math.max(0, effectiveEnd - effectiveStart);
  }

  if (startDateStr === endDateStr) {
    // Same day - just count minutes in the range
    return getBusinessMinutesForDay(
      start,
      startHour,
      startMinute,
      endHour,
      endMinute
    );
  }

  // Different days - count partial first day
  count += getBusinessMinutesForDay(
    start,
    startHour,
    startMinute,
    24,
    0
  );

  // Count full days in between
  const current = new Date(start);
  current.setDate(current.getDate() + 1);

  while (dateFormatter.format(current) < endDateStr) {
    if (isBusinessDay(current, ctx) && !isPTO(current, ctx.ptoIntervals)) {
      count += minutesPerBusinessDay;
    }
    current.setDate(current.getDate() + 1);
  }

  // Count partial last day
  count += getBusinessMinutesForDay(end, 0, 0, endHour, endMinute);

  return count;
}

export function addBusinessDays(
  startDate: Date,
  businessDays: number,
  ctx: BusinessTimeContext
): Date {
  const result = new Date(startDate);
  let daysAdded = 0;

  while (daysAdded < businessDays) {
    result.setDate(result.getDate() + 1);

    // Check if this day counts as a business day
    if (isBusinessDay(result, ctx) && !isPTO(result, ctx.ptoIntervals)) {
      daysAdded++;
    }
  }

  return result;
}

export function getNextBusinessTime(
  from: Date,
  ctx: BusinessTimeContext
): Date {
  const result = new Date(from);
  result.setMinutes(result.getMinutes() + 1);
  result.setSeconds(0, 0);

  while (!isBusinessMinute(result, ctx)) {
    result.setMinutes(result.getMinutes() + 1);
  }

  return result;
}

export function getTotalBusinessMinutesInWindow(
  windowStart: Date,
  windowEnd: Date,
  ctx: BusinessTimeContext
): number {
  return countBusinessMinutes(windowStart, windowEnd, ctx);
}

// For forecasting: find next scheduled review time
export function getNextReviewTime(
  from: Date,
  reviewHour: number,
  ctx: BusinessTimeContext
): Date {
  const result = new Date(from);
  const tzFrom = toTimezone(from, ctx.config.businessHours.timezone);

  // If we're before review time today and it's a business day, return today
  if (
    tzFrom.getHours() < reviewHour &&
    isBusinessDay(from, ctx) &&
    !isPTO(from, ctx.ptoIntervals)
  ) {
    result.setHours(reviewHour, 0, 0, 0);
    return result;
  }

  // Otherwise, find next business day
  result.setDate(result.getDate() + 1);
  while (!isBusinessDay(result, ctx) || isPTO(result, ctx.ptoIntervals)) {
    result.setDate(result.getDate() + 1);
  }

  result.setHours(reviewHour, 0, 0, 0);
  return result;
}
