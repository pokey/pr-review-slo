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

  let count = 0;
  const current = new Date(start);
  current.setSeconds(0, 0);

  // Round up to next minute
  if (current.getTime() < start.getTime()) {
    current.setMinutes(current.getMinutes() + 1);
  }

  while (current < end) {
    if (isBusinessMinute(current, ctx)) {
      count++;
    }
    current.setMinutes(current.getMinutes() + 1);
  }

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

  // Set to end of business day
  const tzResult = toTimezone(result, ctx.config.businessHours.timezone);
  result.setHours(ctx.config.businessHours.end, 0, 0, 0);

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
