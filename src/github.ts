import type { Config, PR } from "./types";

const GITHUB_API = "https://api.github.com";
const GITHUB_GRAPHQL = "https://api.github.com/graphql";

function getToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN environment variable is required.\n" +
        "Create a token at: https://github.com/settings/tokens\n" +
        "Required scopes: repo (for private repos) or public_repo (for public only)"
    );
  }
  return token;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${getToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

interface SearchResult {
  total_count: number;
  items: Array<{
    number: number;
    title: string;
    html_url: string;
    repository_url: string;
    draft: boolean;
  }>;
}

export async function searchPRsRequestingReview(
  username: string,
  repos?: string[]
): Promise<Array<{ repo: string; number: number; url: string; title: string }>> {
  // Build search query
  let query = `review-requested:${username} is:open is:pr -is:draft`;

  // Add repo filter if specified
  if (repos && repos.length > 0) {
    const repoQueries = repos.map((r) => {
      if (r.endsWith("/*")) {
        return `org:${r.slice(0, -2)}`;
      }
      return `repo:${r}`;
    });
    query += ` ${repoQueries.join(" ")}`;
  }

  const url = `${GITHUB_API}/search/issues?q=${encodeURIComponent(query)}&per_page=100`;
  const response = await fetch(url, { headers: headers() });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub search failed: ${response.status} - ${text}`);
  }

  const data = (await response.json()) as SearchResult;

  return data.items.map((item) => ({
    repo: item.repository_url.replace("https://api.github.com/repos/", ""),
    number: item.number,
    url: item.html_url,
    title: item.title,
  }));
}

interface GraphQLResponse {
  data?: {
    repository: {
      pullRequest: {
        additions: number;
        deletions: number;
        isDraft: boolean;
        timelineItems: {
          nodes: Array<{
            __typename: string;
            createdAt?: string;
            requestedReviewer?: {
              login?: string;
            };
          }>;
        };
      };
    };
  };
  errors?: Array<{ message: string }>;
}

export async function getPRDetails(
  repo: string,
  number: number,
  username: string
): Promise<{
  additions: number;
  deletions: number;
  isDraft: boolean;
  requestedAt: Date | null;
}> {
  const [owner, name] = repo.split("/");

  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          additions
          deletions
          isDraft
          timelineItems(first: 100, itemTypes: [REVIEW_REQUESTED_EVENT]) {
            nodes {
              __typename
              ... on ReviewRequestedEvent {
                createdAt
                requestedReviewer {
                  ... on User {
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      query,
      variables: { owner, name, number },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub GraphQL failed: ${response.status} - ${text}`);
  }

  const data = (await response.json()) as GraphQLResponse;

  if (data.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
  }

  const pr = data.data!.repository.pullRequest;

  // Find the most recent review request event for this user
  // Events are returned in chronological order, so we want the last matching one
  let requestedAt: Date | null = null;
  const usernameLower = username.toLowerCase();

  for (const node of pr.timelineItems.nodes) {
    if (
      node.__typename === "ReviewRequestedEvent" &&
      node.requestedReviewer?.login?.toLowerCase() === usernameLower &&
      node.createdAt
    ) {
      requestedAt = new Date(node.createdAt);
    }
  }

  return {
    additions: pr.additions,
    deletions: pr.deletions,
    isDraft: pr.isDraft,
    requestedAt,
  };
}

export async function fetchInScopePRs(config: Config): Promise<PR[]> {
  const { username, repos } = config.github;

  if (!username) {
    throw new Error(
      "GitHub username not configured. Run: pr-review-slo init <username>"
    );
  }

  // Search for PRs where review is requested
  const searchResults = await searchPRsRequestingReview(username, repos);

  // Fetch details for each PR
  const prs: PR[] = [];

  for (const result of searchResults) {
    try {
      const details = await getPRDetails(result.repo, result.number, username);

      // Skip if we couldn't determine when review was requested
      if (!details.requestedAt) {
        console.error(
          `Warning: Could not find review request time for ${result.repo}#${result.number}`
        );
        continue;
      }

      // Skip drafts (should be filtered by search, but double-check)
      if (details.isDraft) {
        continue;
      }

      prs.push({
        repo: result.repo,
        number: result.number,
        url: result.url,
        title: result.title,
        requestedAt: details.requestedAt,
        loc: details.additions + details.deletions,
        additions: details.additions,
        deletions: details.deletions,
        isDraft: details.isDraft,
      });
    } catch (err) {
      console.error(
        `Warning: Failed to fetch details for ${result.repo}#${result.number}: ${err}`
      );
    }
  }

  return prs;
}
