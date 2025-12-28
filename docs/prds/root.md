## SLO definition: PR Review Responsiveness (My Reviewer Queue)

**PR Review Responsiveness SLO:** Over any rolling 30‑day window, **at least 90% of business minutes** have **zero overdue PR review requests** assigned to me (scoped to non‑draft, open PRs under a size limit).

One-sentence “plain English” version:

> During business time, I keep my “review requested” queue from going overdue at least 90% of the time over the last 30 days.

## Define the service

### Service name

**“PR Review Responsiveness (My Reviewer Queue)”**

### Service users / customers

- Primary: PR authors who request my review (or for whom I’m requested via CODEOWNERS / rules).
- Secondary: the team relying on merge throughput and review quality.

### What the service provides

Timely turnaround on review requests so PRs are not blocked waiting on me.

### In-scope items

A PR is **in scope** at measurement time _t_ if all are true:

1. **Repository scope**: PR is in configured org(s)/repo(s).
2. **Open PR**: PR state is open (not merged/closed).
3. **Not a draft**: PR is not in draft state.
4. **Review requested from me**: I am currently a requested reviewer (direct user request).

   - You can find PRs where I’m requested via the `review-requested:[USERNAME]` search qualifier. ([GitHub Docs][1])

5. **Size bucket supported**: PR size (LOC estimate) is `< 800` (details below).

### Out-of-scope items

- Draft PRs.
- Closed or merged PRs.
- PRs where I am _not currently_ requested as reviewer.
- PRs with “large” size bucket (≥ 800 LOC) — explicitly excluded to encourage breaking large changes into smaller reviews.

## Formalize the SLI

### Business minutes

Let **BusinessMinutes(t0, t1]** be the count of minutes in the interval that are considered “business minutes” under my calendar rules.

Recommended v1 rules (configurable):

- Business days: Mon–Fri.
- Business hours: 09:00–19:00 (local time).
- Exclude public holidays (see holiday section).
- (PTO handling: see below; v1 can ignore or treat as business time.)

### Deadline per PR

For each in-scope PR _p_ at time _t_:

1. Determine **request timestamp** `req_at(p)` = timestamp of the **most recent review request** for me on this PR that corresponds to the **current** outstanding request.

   - You can get review-requested PRs via search qualifiers (`review-requested:[USERNAME]`, plus optionally `team-review-requested:[TEAMNAME]` later). ([GitHub Docs][1])
   - For the request event payload in GraphQL timeline items, GitHub deprecated `subject` in favor of `requestedReviewer` on `ReviewRequestedEvent`. ([GitHub Docs][2])
     (So filter on `requestedReviewer` rather than `subject`.)

2. Compute LOC `loc(p)` (v1: `additions + deletions`).
   - INVESTIGATE: Is there a better metric exposed by GitHub GraphQL API?
3. Assign bucket:

   - **Small**: `loc < 200` ⇒ allowed time = **1 business day**
   - **Medium**: `loc < 800` ⇒ allowed time = **3 business days**
   - **Large**: otherwise ⇒ discard from SLO measurement

4. Deadline:

   - `deadline(p) = add_business_days(req_at(p), allowed_days(bucket(p)))`

### Overdue condition

A PR is **overdue** at time _t_ if:

- `t > deadline(p)`

### Minute-level service health

Define an indicator function for each business minute `m`:

- `Healthy(m) = 1` if **no** in-scope PR is overdue at minute `m`
- `Healthy(m) = 0` otherwise

This matches “good means no overdue PRs” framing.

### SLI definition

For a rolling window **W = (T-30d, T]**:

- `GoodMinutes(W) = Σ_{m ∈ W business minutes} Healthy(m)`
- `TotalBusinessMinutes(W) = BusinessMinutes(T-30d, T]`
- `SLI(W) = GoodMinutes(W) / TotalBusinessMinutes(W)`

## SLO target + error budget

### SLO

**SLO:** `SLI(W) ≥ 0.90` for every rolling 30‑day window W.

### Error budget

Define:

- `BudgetMinutes(W) = 0.10 × TotalBusinessMinutes(W)`
- `BadMinutes(W) = TotalBusinessMinutes(W) − GoodMinutes(W)`

SLO is met iff:

- `BadMinutes(W) ≤ BudgetMinutes(W)`

## Error budget contribution computation

```console
$ pr-review-slo compute-error-budget-contribution
```

### Key observation

Because deadlines are monotonic, if you sort PRs by deadline then:

- If the **earliest deadline PR** is not overdue, **none** are overdue.
- If it is overdue, the service is “bad” until that earliest-deadline PR is reviewed/removed.

So using `minDeadline` is correct for your “any overdue ⇒ bad minute” SLI.

### Daily “error-budget-contribution” run

At run time `now`, with previous run `prev`:

1. Fetch in-scope PRs (open, non-draft, review requested from me).
2. Compute `deadline(p)` for each; let `d_min = min(deadline(p))` (or `+∞` if none).
3. Define:

   - `interval = (prev, now]`
   - `intervalBusiness = BusinessMinutes(prev, now]`

4. If `d_min >= now` or no PRs:

   - `badMinutes = 0`
   - `badInterval = ∅`

5. Else (something is overdue now):

   - Bad interval inside this run is:

     - `badStart = max(prev, d_min)`
     - `badEnd = now`

   - `badMinutes = BusinessMinutes(badStart, badEnd]`

### What to store each run (high-value schema)

Store one JSON object per run (JSONL):

```json
{
  "type": "budget_run",
  "run_at": "2025-12-28T12:30:00-08:00",
  "prev_run_at": "2025-12-27T12:30:00-08:00",
  "interval_business_minutes": 480,
  "bad_minutes": 35,
  "bad_interval": {
    "start": "2025-12-28T11:55:00-08:00",
    "end": "2025-12-28T12:30:00-08:00"
  },
  "min_deadline": "2025-12-28T11:55:00-08:00",
  "prs": [
    {
      "repo": "org/repo",
      "number": 123,
      "url": "...",
      "title": "...",
      "requested_at": "...",
      "loc": 178,
      "deadline": "..."
    }
  ]
}
```

Why this matters:

- Sliding-window capping becomes “business-minute overlap of intervals”

## “Get PRs to review” policy

```console
$ pr-review-slo get-prs-to-review
```

### Purpose

Before you start reviewing after lunch, decide:

1. **Must-do today** (to avoid exceeding budget by the next check time).
2. **Extra credit** (reviewing now increases buffer but isn’t strictly required).

### Choose the forecast horizon

Let `T_next` = **next scheduled review time** (e.g., next business day at 12:30).

- This automatically handles weekends/holidays without special casing.

### Forecast “if I review nothing else”

Given current time `now`, horizon `T_next`, and earliest deadline among remaining PRs `d_min`:

- Projected additional bad minutes from now until `T_next`:

  - If `d_min >= T_next`: `projBad = 0`
  - Else: `projBad = BusinessMinutes(max(now, d_min), T_next]`

### Rolling window budget at horizon time

Let `W_next = (T_next - 30d, T_next]`.

Compute:

- `histBad = Σ overlap_business_minutes(badInterval_i, W_next)` over all stored runs
- `budget = 0.10 × TotalBusinessMinutes(W_next)`
- `totalBadIfNoReviews = histBad + projBad`

If `totalBadIfNoReviews > budget`, you must review something now.

### Selecting the must-do PRs

Let PRs be sorted by deadline: `p0, p1, ...`

For k = 0..N:

- Assume I review `{p0..p(k-1)}` **now** (so they disappear from “requested” set).
- Let `d_k` = min deadline among remaining `{pk..}`
- Compute `projBad_k` using `d_k`
- Compute `totalBad_k = histBad + projBad_k`
- If `totalBad_k > budget`, then `pk` is **mandatory today**; continue.
- Else break — you can stop; everything from `pk` onward can wait until `T_next` without violating budget.

### Extra-credit PRs

Define the “first safe-to-wait” PR index as `k_stop`.

Candidates for extra credit are PRs starting at `k_stop` where **waiting will burn budget** but **won’t exceed it**.

Practically:

- Start from current “safe-to-wait” set.
- Show the next few PRs whose deadlines are before `T_next` (they will create `projBad > 0`).
- For each candidate `pi`, compute:

  - **Total burn avoided** if you review it (and any earlier ones already assumed reviewed):

    - `savedBad_i = projBad_current − projBad_after_reviewing_up_to_i`

  - **Percent of remaining budget**:

    - `savedBad_i / (budget - histBad)` (clamp 0..1)

  - **Incremental vs next most urgent**:

    - `incremental_i = savedBad_i − savedBad_{i+1}`

This answers questions like:

- “How much error budget total they burn” (or save, depending on framing)
- “As % of remaining they burn”
- “Incremental burn if reviewed this PR but not next most urgent”

## PTO + holidays policy

### Public holidays

**Use a public holiday API** and cache locally. Nager.Date is a popular option and provides public holiday data for many countries plus endpoints like `GET /api/v3/PublicHolidays/{Year}/{CountryCode}`. ([date.nager.at][3])

Given your “lean into Bun stdlib” preference, you can still do (2) with plain `fetch()` and cache yearly results to disk.

### PTO

**PTO minutes excluded from business minutes.**

- Pros: Your SLO measures responsiveness only when “on duty.”
- Cons: Can hide the real wait time experienced by others; incentivizes scheduling.

### Command to set PTO intervals

```console
$ pr-review-slo add-pto --from "2025-12-24" --to "2025-12-31"
```

## Implementation notes aligned to your Bun goals

### CLI parsing

Bun exposes CLI args via `Bun.argv`. ([Bun][4])
For structured parsing, Bun docs explicitly point to using Node’s `util.parseArgs`. ([Bun][4])

So you can do:

- `Bun.argv` as source of truth
- `parseArgs({ args: Bun.argv, options, ... })`
- Support config file (TOML) and then apply CLI overrides.

### GitHub API fetching strategy

- Use GitHub search qualifiers to locate PRs where review is requested. ([GitHub Docs][1])
- Then query details via GraphQL (title/url/additions/deletions/isDraft/etc.).
- For “most recent review request timestamp,” use timeline events and filter by `requestedReviewer` (not `subject`). ([GitHub Docs][2])

### Storage (JSONL event log)

Your JSONL “append-only log + fold on load” is a good v1.

## Justification of key choices

### Why rolling 30 days?

- Rolling windows are harder to game than calendar months and match typical SLO practice (continuous accountability).

### Why 90% / 10% budget?

- Gives a meaningful buffer for inevitable busy days while still maintaining strong responsiveness.
- Easy mental model: “I can be overdue up to ~10% of business time.”

### Why “any overdue PR ⇒ bad minute”?

- It matches the service intent: **the queue being overdue is what matters**, not how many items are overdue.
- It keeps burn rate understandable and makes “min deadline” sufficient for correctness.

### Why LOC buckets and deadlines?

- Explicitly ties the SLO to expected review effort.
- Excluding very large PRs prevents one outlier from dominating the SLO and encourages breaking changes down.

### Why daily measurement?

- Operationally simple and aligns with your “post-lunch review session.”
- You’ve already acknowledged the limitation: you can miss short-lived overdue periods that resolve between runs. If you ever care, increase frequency or use webhooks.

## A couple of “PR review” style nits and improvements (worth doing early)

3. **Define LOC metric precisely**
   Pick one and document it (e.g., `additions + deletions`). If you ever change it, version the SLI.

4. **Clarify what “responded” means**
   Your design implicitly treats “request no longer outstanding” as “responded.” That’s consistent with GitHub’s semantics around requested reviewers. ([GitHub Docs][5])
   Keep that as the definition to avoid subjective states.

[1]: https://docs.github.com/articles/viewing-a-pull-request-review "Viewing a pull request review - GitHub Docs"
[2]: https://docs.github.com/en/graphql/overview/changelog "Changelog - GitHub Docs"
[3]: https://date.nager.at/API "Public Holiday API - Nager.Date"
[4]: https://bun.com/docs/guides/process/argv "Parse command-line arguments - Bun"
[5]: https://docs.github.com/en/rest/pulls/review-requests "REST API endpoints for review requests - GitHub Docs"
