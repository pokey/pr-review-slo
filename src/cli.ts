#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { computeErrorBudgetContributionCommand } from "./commands/compute-error-budget";
import { getPRsToReviewCommand } from "./commands/get-prs-to-review";
import { addPTOCommand, listPTOCommand } from "./commands/add-pto";
import { initCommand } from "./commands/init";
import { statusCommand } from "./commands/status";

const HELP = `
pr-review-slo - Track your PR review responsiveness SLO

USAGE:
  pr-review-slo <command> [options]

COMMANDS:
  init <username>                 Initialize configuration for a GitHub user
  compute-error-budget-contribution
                                  Record current PR queue and compute error budget contribution
  get-prs-to-review [--review-hour=N]
                                  Get recommendations for which PRs to review
  add-pto --from=YYYY-MM-DD --to=YYYY-MM-DD
                                  Add a PTO interval
  list-pto                        List all PTO intervals
  status [--json]                 Show current SLO status and configuration

OPTIONS:
  --help, -h                      Show this help message

ENVIRONMENT:
  GITHUB_TOKEN                    GitHub personal access token (required for API calls)

EXAMPLES:
  pr-review-slo init myusername
  pr-review-slo compute-error-budget-contribution
  pr-review-slo get-prs-to-review --review-hour=13
  pr-review-slo add-pto --from=2025-12-24 --to=2025-12-31
`;

async function main() {
  const args = Bun.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(HELP);
    return;
  }

  const command = args[0];

  try {
    switch (command) {
      case "init": {
        const username = args[1];
        if (!username) {
          console.error("Error: Username required");
          console.error("Usage: pr-review-slo init <github-username>");
          process.exit(1);
        }
        await initCommand(username);
        break;
      }

      case "compute-error-budget-contribution": {
        await computeErrorBudgetContributionCommand();
        break;
      }

      case "get-prs-to-review": {
        const { values } = parseArgs({
          args: args.slice(1),
          options: {
            "review-hour": { type: "string" },
          },
          allowPositionals: true,
        });
        const reviewHour = values["review-hour"]
          ? parseInt(values["review-hour"], 10)
          : undefined;
        await getPRsToReviewCommand({ reviewHour });
        break;
      }

      case "add-pto": {
        const { values } = parseArgs({
          args: args.slice(1),
          options: {
            from: { type: "string" },
            to: { type: "string" },
          },
          allowPositionals: true,
        });
        if (!values.from || !values.to) {
          console.error("Error: --from and --to are required");
          console.error(
            "Usage: pr-review-slo add-pto --from=YYYY-MM-DD --to=YYYY-MM-DD"
          );
          process.exit(1);
        }
        await addPTOCommand({ from: values.from, to: values.to });
        break;
      }

      case "list-pto": {
        await listPTOCommand();
        break;
      }

      case "status": {
        const { values } = parseArgs({
          args: args.slice(1),
          options: {
            json: { type: "boolean" },
          },
          allowPositionals: true,
        });
        await statusCommand({ json: values.json ?? false });
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main();
