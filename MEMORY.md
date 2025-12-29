# PR Review SLO Implementation Memory

## Project Status: Complete (v1.0)

## Completed
- [x] Core types and interfaces
- [x] Configuration loading (TOML parser, defaults)
- [x] Business time calculations (holidays, PTO, business hours)
- [x] Holiday fetching from Nager.Date API with caching
- [x] PTO storage and management
- [x] JSONL storage for budget runs
- [x] GitHub API integration (search + GraphQL)
- [x] SLO/SLI calculations
- [x] CLI commands:
  - `init` - Initialize configuration
  - `compute-error-budget-contribution` - Record queue and compute contribution
  - `get-prs-to-review` - Get review recommendations
  - `add-pto` - Add PTO intervals
  - `list-pto` - List PTO intervals
  - `status` - Show current SLO status
- [x] Tests for business-time and SLO calculations

## Current Focus
- Implementation complete, ready for testing with real GitHub data

## Architecture Decisions

### File Structure
```
src/
  cli.ts           - CLI entry point with parseArgs
  github.ts        - GitHub API integration (search + GraphQL)
  business-time.ts - Business minutes calculation
  holidays.ts      - Holiday fetching from Nager.Date API
  storage.ts       - JSONL append-only log
  slo.ts           - SLO/SLI calculations
  config.ts        - Configuration loading (TOML)
  commands/
    compute-error-budget.ts
    get-prs-to-review.ts
    add-pto.ts
```

### Key Constants
- Business hours: 09:00-17:00
- Business days: Mon-Fri
- SLO target: 90%
- Rolling window: 30 days
- Size buckets:
  - Small: <200 LOC → 1 business day
  - Medium: <800 LOC → 3 business days
  - Large: ≥800 LOC → excluded

### Storage Location
- Data directory: `~/.pr-review-slo/`
- Budget runs: `~/.pr-review-slo/budget-runs.jsonl`
- PTO intervals: `~/.pr-review-slo/pto.jsonl`
- Holiday cache: `~/.pr-review-slo/holidays-{year}.json`
- Config: `~/.pr-review-slo/config.toml`

## Implementation Notes

### GitHub API Strategy
1. Use REST search API: `review-requested:USERNAME is:open is:pr -is:draft`
2. Use GraphQL for detailed PR info including timeline events
3. Filter timeline for `ReviewRequestedEvent` with `requestedReviewer` matching current user

### Business Minutes Calculation
- Native Date with timezone conversion via toLocaleString
- Cache holidays per year from Nager.Date API
- PTO intervals stored in JSONL and loaded on startup

## Usage

```bash
# Initialize with your GitHub username
bun run src/cli.ts init <github-username>

# Record current PR queue and compute error budget contribution
GITHUB_TOKEN=xxx bun run src/cli.ts compute-error-budget-contribution

# Get recommendations for what to review
GITHUB_TOKEN=xxx bun run src/cli.ts get-prs-to-review

# Add PTO
bun run src/cli.ts add-pto --from=2025-12-24 --to=2025-12-31

# Check status
bun run src/cli.ts status
```

## Open Questions
- None currently

## Future Enhancements
- Webhook support for real-time updates
- Team-level SLOs (aggregate across multiple users)
- Integration with calendar for automatic PTO detection
- Dashboard/web UI
