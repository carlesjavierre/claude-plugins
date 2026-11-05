---
description: Show decision-model usage stats per model and provider (calls, errors, latency, input tokens, cost, agreement)
model: haiku
---

Call the decision-models `stats` tool once, then reply with exactly, for each period (today, last 7 days, all time) that has calls:

1. A heading with the period, its number of calls and questions, and its cost as `$<cost_usd>` (append ` est.` when `cost_estimated` is true).
2. A table with one row per `route` (model via provider, with the host in parentheses when known): calls, errors, p50 latency, p95 latency, input tokens, cost (`$` with up to 6 decimals, marked `est.` when `cost_estimated`, or `unknown` when `cost_unknown`).
3. If `consensus.questions` > 0: one line `Agreement: <agreed>/<questions> multi-model questions agreed (<percent>%)`.
4. One line: `Cost: actual where the provider reports it (OpenRouter, Vercel), otherwise estimated from public list prices as of <prices_as_of>.` If `cost_incomplete`, add: `Some calls have no known price (custom gateway models), so the total is incomplete.`

If the tool returns an `error` or `note`, show it instead. Do not add anything else.
