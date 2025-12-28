import { saveDefaultConfig, paths } from "../config";

export async function initCommand(username: string): Promise<void> {
  if (!username) {
    console.error("Usage: pr-review-slo init <github-username>");
    process.exit(1);
  }

  await saveDefaultConfig(username);

  console.log(`Initialized pr-review-slo for GitHub user: ${username}`);
  console.log(`\nConfiguration saved to: ${paths.config}`);
  console.log(`\nNext steps:`);
  console.log(`1. Ensure GITHUB_TOKEN is set in your environment`);
  console.log(`   export GITHUB_TOKEN=ghp_xxxxxxxxxxxx`);
  console.log(`\n2. Edit the config file to customize settings:`);
  console.log(`   ${paths.config}`);
  console.log(`\n3. Run the SLO check:`);
  console.log(`   pr-review-slo compute-error-budget-contribution`);
  console.log(`\n4. Get review recommendations:`);
  console.log(`   pr-review-slo get-prs-to-review`);
}
