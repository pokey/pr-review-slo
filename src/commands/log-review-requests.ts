import { loadConfig } from "../config";
import { fetchInScopePRs } from "../github";
import { appendBudgetRun } from "../storage";
import type { BudgetRun } from "../types";

export async function logReviewRequestsCommand(): Promise<void> {
  const config = await loadConfig();
  const now = new Date();

  console.log("Fetching PRs requesting review...");
  const prs = await fetchInScopePRs(config);
  console.log(`Found ${prs.length} PR(s) requesting review.`);

  // Create and store the budget run (just the facts)
  const budgetRun: BudgetRun = {
    type: "budget_run",
    runAt: now.toISOString(),
    prs: prs.map((pr) => ({
      url: pr.url,
      title: pr.title,
      requestedAt: pr.requestedAt.toISOString(),
      loc: pr.loc,
      reviewedAt: null,
      requestedReviewer: pr.requestedReviewer,
      asCodeOwner: pr.asCodeOwner,
    })),
  };

  await appendBudgetRun(budgetRun);

  console.log(`\nLogged ${prs.length} PR(s) at ${now.toISOString()}`);

  if (prs.length > 0) {
    console.log("\n=== PRs Logged ===");
    for (const pr of prs) {
      const codeOwnerTag = pr.asCodeOwner ? " [code owner]" : "";
      console.log(`${pr.repo}#${pr.number} (${pr.loc} LOC)`);
      console.log(`  Title: ${pr.title}`);
      console.log(`  Requested by: ${pr.requestedReviewer}${codeOwnerTag}`);
      console.log(`  Requested: ${pr.requestedAt.toISOString()}`);
      console.log(`  URL: ${pr.url}`);
    }
  }
}
