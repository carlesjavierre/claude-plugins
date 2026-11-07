---
description: Show decision-model usage stats (all time and per day for the last week, by source), or clear them with "clear"
argument-hint: "[clear]"
model: haiku
---

If the arguments are `clear`: call the decision-models `clear_stats` tool once and reply with exactly `Cleared <cleared_calls> recorded calls.` (or its `error`). Do nothing else.

Otherwise call the decision-models `stats` tool once. If it returns an `error` or `note`, show it instead. Otherwise reply with exactly the following, naming sources as: `ask` → Ask tool (Claude or /opinion), `commit` → Commit checks, `triage` → Long-output triage, `early-stop` → Early-stop checks, `untagged` → Untagged (logged before sources were recorded). Write each cost as `$` with up to 6 decimals, followed by ` est.` when its `cost_estimated` is true.

1. `## All time (since <date of since>)` and one line: calls, questions and cost from `all_time`.
2. A table from `all_time.by_source`, one row per source: source, calls, questions, cost.
3. A table from `all_time.models`, one row per `route` (model via provider, with the host in parentheses when known): calls, errors, p50 latency, p95 latency, input tokens, cost (`unknown` when `cost_unknown`).
4. If `all_time.consensus.questions` > 0: one line `Agreement: <agreed>/<questions> multi-model questions agreed (<percent>%)`.
5. A table from `all_time.by_project`, one row per project folder (most calls first): project, total, then one column per source that appears. Each cell is `<calls> calls · <cost>`, or `–` when that source has no calls there. `unknown` is calls logged before projects were recorded.
6. If `last_7_days` is not empty: `## Last 7 days` and a table with one row per day (newest first): the date, the day's total, then one column per source that appears in any day, cells as above. Then the same per-project table built from `last_7_days_by_project`.
7. One line: `Cost: actual where the provider reports it (OpenRouter, Vercel), otherwise estimated from public list prices as of <prices_as_of>.` If `all_time.cost_incomplete`, add: `Some calls have no known price (custom gateway models), so the total is incomplete.`

Do not add anything else.
