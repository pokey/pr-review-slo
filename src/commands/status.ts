import { loadConfig, paths } from "../config";
import { createBusinessTimeContext } from "../business-time";
import { loadPTOIntervals, loadBudgetRuns } from "../storage";
import { computeSLI } from "../slo";
import pc from "picocolors";

interface StatusOptions {
  json: boolean;
}

export async function statusCommand(options: StatusOptions): Promise<void> {
  const config = await loadConfig();
  const now = new Date();

  // Load data
  const ptoIntervals = await loadPTOIntervals();
  const budgetRuns = await loadBudgetRuns();

  // Create business time context for rolling window
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - config.slo.windowDays);

  const ctx = await createBusinessTimeContext(
    config,
    ptoIntervals,
    windowStart,
    now
  );

  // Compute current SLI
  const sli = computeSLI(budgetRuns, windowStart, now, ctx);

  const today = now.toISOString().slice(0, 10);
  const activePTO = ptoIntervals.filter((p) => p.end >= today);

  if (options.json) {
    const lastRun = budgetRuns.length > 0 ? budgetRuns[budgetRuns.length - 1]! : null;
    console.log(JSON.stringify({
      githubUser: config.github.username || null,
      dataDirectory: paths.dataDir,
      budgetRuns: budgetRuns.length,
      sli: {
        windowDays: config.slo.windowDays,
        windowStart: windowStart.toISOString(),
        windowEnd: now.toISOString(),
        value: sli.sli,
        target: config.slo.target,
        isMet: sli.isMet,
        goodMinutes: sli.goodMinutes,
        badMinutes: sli.badMinutes,
        totalMinutes: sli.totalBusinessMinutes,
        budgetMinutes: sli.budgetMinutes,
        budgetRemaining: sli.budgetRemaining,
      },
      lastRun: lastRun ? {
        time: lastRun.runAt,
        prsInQueue: lastRun.prs.length,
      } : null,
      config: {
        businessHours: {
          start: config.businessHours.start,
          end: config.businessHours.end,
          timezone: config.businessHours.timezone,
        },
        businessDays: config.businessDays,
        holidayCountryCode: config.holidayCountryCode,
        sizeBuckets: config.sizeBuckets,
      },
      activePTO,
    }, null, 2));
    return;
  }

  const label = (s: string) => pc.dim(s);
  const value = (s: string | number) => pc.white(String(s));
  const heading = (s: string) => pc.bold(pc.cyan(s));

  console.log();
  console.log(heading("PR Review SLO Status"));
  console.log();
  console.log(`${label("GitHub user")}      ${value(config.github.username || "(not configured)")}`);
  console.log(`${label("Data directory")}   ${value(paths.dataDir)}`);
  console.log(`${label("Budget runs")}      ${value(budgetRuns.length)}`);
  console.log();

  console.log(heading("Current SLI") + pc.dim(` (${config.slo.windowDays}-day rolling window)`));
  console.log();
  const sliPercent = sli.sli * 100;
  const targetPercent = config.slo.target * 100;
  const sliColor = sli.isMet ? pc.green : pc.red;

  console.log(`${label("SLI")}              ${sliColor(pc.bold(sliPercent.toFixed(2) + "%"))} ${pc.dim("/")} ${value(targetPercent.toFixed(0) + "%")} target`);
  console.log(`${label("Budget remaining")} ${sliColor(sli.budgetRemaining.toFixed(0) + " min")} ${pc.dim("/")} ${value(sli.budgetMinutes.toFixed(0) + " min")} total`);
  console.log();
  console.log(`${label("Good minutes")}     ${pc.green(sli.goodMinutes.toString())}`);
  console.log(`${label("Bad minutes")}      ${sli.badMinutes > 0 ? pc.red(sli.badMinutes.toString()) : pc.dim("0")}`);
  console.log(`${label("Total minutes")}    ${value(sli.totalBusinessMinutes)}`);
  console.log();

  if (sli.isMet) {
    console.log(pc.bgGreen(pc.black(" ✓ SLO MET ")));
  } else {
    console.log(pc.bgRed(pc.white(" ✗ SLO VIOLATED ")));
  }

  // Last run info
  if (budgetRuns.length > 0) {
    const lastRun = budgetRuns[budgetRuns.length - 1]!;
    console.log();
    console.log(heading("Last Run"));
    console.log();
    console.log(`${label("Time")}             ${value(lastRun.runAt)}`);
    console.log(`${label("PRs in queue")}     ${value(lastRun.prs.length)}`);
  }

  // Configuration summary
  console.log();
  console.log(heading("Configuration"));
  console.log();
  console.log(
    `${label("Business hours")}   ${value(`${config.businessHours.start}:00-${config.businessHours.end}:00`)} ${pc.dim(`(${config.businessHours.timezone})`)}`
  );
  console.log(
    `${label("Business days")}    ${value(config.businessDays.map((d) => ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]).join(", "))}`
  );
  console.log(`${label("Holiday country")}  ${value(config.holidayCountryCode)}`);
  console.log(
    `${label("Size buckets")}     ${pc.dim("S")} ${value(`<${config.sizeBuckets.small.maxLoc} LOC, ${config.sizeBuckets.small.businessDays}d`)}  ${pc.dim("M")} ${value(`<${config.sizeBuckets.medium.maxLoc} LOC, ${config.sizeBuckets.medium.businessDays}d`)}`
  );

  // Active PTO
  if (activePTO.length > 0) {
    console.log();
    console.log(heading("Active/Future PTO"));
    console.log();
    for (const p of activePTO) {
      console.log(`  ${pc.yellow(p.start)} ${pc.dim("→")} ${pc.yellow(p.end)}`);
    }
  }

  console.log();
}
