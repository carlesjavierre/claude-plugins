# decision-models

Lets Claude, and you, ask cheap **decision models** typed questions and get calibrated probabilities back:

- **yes/no**: probability that the statement is true
- **choice**: one of your options, with per-option probabilities. Every choice also gets an `other` option and a hidden "does any option fit?" check; `none_fit` is set when the model picks `other` or the check says nothing fits
- **score**: a level on your ordered scale

Claude uses it on its own (through the bundled `consulting-decision-models` skill) to triage files and logs it hasn't read and to get cheap second opinions, at a fraction of its own token cost. Ask several models at once and they must agree unanimously, or Claude investigates instead.

## Install

```
/plugin install decision-models --marketplace carlesjavierre/claude-plugins
```

Requires Node.js 20 or later. Set at least one API key when prompted, or later with `claude plugin configure decision-models`. Keys are stored in your system keychain. Any key left empty falls back to the environment variable listed below.

## Models and providers

| Model | Provider | Key (option / env var) | Status |
|---|---|---|---|
| `jev` (always latest) | TypeSafe | `typesafeApiKey` / `TYPESAFE_API_KEY` | tested |
| `jev`, `clef`, `clef-flash`, `gpt-6-luna` | OpenRouter | `openrouterApiKey` / `OPENROUTER_API_KEY` | untested |
| `jev` | Vercel AI Gateway | `vercelApiKey` / `AI_GATEWAY_API_KEY` | untested |
| `clef`, `clef-flash` | Cloudflare Workers AI | `cloudflareApiToken` + `cloudflareAccountId` / `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` | untested |
| `gpt-6-luna` | OpenAI | `openaiApiKey` / `OPENAI_API_KEY` | untested |
| `gpt-6-luna` | Vercel AI Gateway | `vercelApiKey` / `AI_GATEWAY_API_KEY` | untested |
| `jev` (as `typesafe/jev-1.14.0`), `gpt-6-luna` (as `openai/decisions`) | Cloudflare (third-party models) | same Cloudflare token + account ID; no TypeSafe/OpenAI key, billed from Unified billing credits | untested |
| any | Custom gateway | `customUrl`, `customFormat`, `customApiKey`, `customModels` | untested |

**Cloudflare**: one API token with **Account > Workers AI > Read** reaches all four models (a token with only AI Gateway permissions is refused). Clef and Clef-flash run on Workers AI; Jev and GPT-6 Luna run as third-party models, billed from AI Gateway Unified billing credits, so load credits first. Set `cloudflareGatewayId` to send every Cloudflare request through one of your AI Gateways (logging, caching, rate limits, Unified billing): same endpoint and token plus a `cf-aig-gateway-id` header. Cloudflare pins `typesafe/jev` to 1.13 and has no latest alias, so the plugin names `typesafe/jev-1.14.0` and needs a bump when a newer Jev ships there.

**OpenRouter routing** (`openrouterSort`): OpenRouter serves some models through several hosts (Clef-flash has four). `default` keeps your OpenRouter account routing; `latency` prefers the fastest host, `price` the cheapest.

When a model is reachable through several providers, the vendor's own API is used first, then gateways. Set `preferredProvider` to change that.

**Custom gateway**: `customUrl` is the full endpoint URL, `customFormat` is `systemone` (the Jev/Clef request shape) or `openai` (the OpenAI Decisions shape), and `customModels` maps model names to the gateway's IDs, e.g. `jev=typesafe/jev`.

## Default model and consensus

These plugin options decide what Claude and `/opinion` ask:

- **Use Jev / Use Clef / Use Clef-flash / Use GPT-6 Luna** (all on by default): which configured models count when asking all of them, that is in consensus, `/opinion-all` and `cheapest`. An OpenRouter key alone reaches all four; untick the ones you don't want. Naming a model explicitly (`/opinion clef …`) still works when it's unticked.
- **Default model**: `cheapest` (the default; jev, then clef-flash, gpt-6-luna, clef, among those enabled) or one of the four models.
- **Consensus**:
  - `off` (the default): ask only the default model.
  - `unanimous`: ask every enabled model; an answer counts only if all that answered agree.
  - `majority`: ask every enabled model; the answer of more than half of those that answered wins (2 of 3 is enough, 1 of 2 isn't).

Answers match when they land on the same side of 0.5 (yes/no), the same option or `none_fit` (choice), or the same level (score). A model that errors is left out, and the result is flagged `partial` with its error. `/opinion jev,clef …` asks a specific set for one call, using the same agreement rule (unanimous when consensus is off).

## Commands

```
/opinion is this ticket about billing, technical or sales? /abs/path/ticket.txt
/opinion jev,clef is this log showing a regression? build.log
/opinion choice: billing, technical, sales — what is this about? ticket.txt
/opinion-all how severe is this incident? incident.md
```

- `/opinion` asks the default model, or the model or set named first.
- `/opinion-all` asks every configured model.
- `/decision-models:stats` shows usage per model and provider (calls, errors, p50/p95 latency, input tokens, cost, how often multi-model questions agreed) for today, the last 7 days and all time. Cost is the actual charge where the provider reports it (OpenRouter and Vercel, which also name the host that served each call), otherwise an estimate (TypeSafe, Cloudflare and OpenAI report tokens only) from public input prices as of 2026-11-01 (jev $0.042, clef $0.24, clef-flash $0.038, gpt-6-luna $0.10 per 1M input tokens; output is free), marked `est.`; a custom-gateway model with no known price shows `unknown` and marks the total incomplete. Only numbers are logged, to `calls.jsonl` in the plugin's data folder (`~/.claude/plugins/data/…`, removed on uninstall), never question text or inputs.
- `/decision-models:setup` shows which providers are configured and where each key comes from (never the key), tests every configured model, and shows the default.
- All four run on Haiku, not your session's model, to keep them fast and cheap.
- The question type (yes/no, choice, score) is inferred from your wording. Override it with a `yes_no:`, `choice: … —` or `score: … —` prefix (score levels lowest first).

## When Claude uses it

A short note at session start (and after `/clear` or compaction) tells Claude to prefer the decision models for yes/no, bucket and score judgments: triaging diffs, logs, test output, search hits or review findings, locating which files implement something, checking an edit against a project rule, checking a screenshot. The `consulting-decision-models` skill has the workflow.

For bulk work, the `ask` tool takes `items`: up to 500 file or image paths judged separately with the same questions in one call, returning counts per answer and the uncertain items. Write **jevify** anywhere in a prompt ("jevify the files in the last commit: which are unrelated to its subject?") to make Claude run the full bulk workflow: fix the questions before looking at the data, pre-filter, judge every unit in one batch, then read only what's flagged.

**Write paths without `@`.** `@file` attaches the whole file to Claude's prompt before the model sees it, which spends the tokens this plugin exists to save. A bare path is read by the server and never enters Claude's context.

## Development

```
npm install
npm run typecheck
npm run build   # writes dist/server.js, which is committed
cd ../.. && claude --plugin-dir plugins/decision-models
```
