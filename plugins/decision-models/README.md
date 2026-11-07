# decision-models

Lets Claude, and you, ask cheap **decision models** typed questions and get calibrated probabilities back:

- **yes/no**: probability that the statement is true
- **choice**: one of your options, with per-option probabilities. Every choice also gets an `other` option and a hidden "does any option fit?" check; `none_fit` is set when the model picks `other` or the check says nothing fits
- **score**: a level on your ordered scale

Claude uses it on its own (through the bundled `consulting-decision-models` skill) to triage files and logs it hasn't read and to get cheap second opinions, at a fraction of its own token cost. Ask several models at once and they must agree (unanimously or by majority, your choice), or Claude investigates instead.

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
| `jev` (as `jev-1.13`, text only) | OpenCode Zen | `opencodeApiKey` / `OPENCODE_API_KEY` | untested |
| any | Custom gateway | `customUrl`, `customFormat`, `customApiKey`, `customModels` | untested |

**Cloudflare**: one API token with **Account > Workers AI > Read** reaches all four models (a token with only AI Gateway permissions is refused). Clef and Clef-flash run on Workers AI; Jev and GPT-6 Luna run as third-party models, billed from AI Gateway Unified billing credits, so load credits first. Set `cloudflareGatewayId` to send every Cloudflare request through one of your AI Gateways (logging, caching, rate limits, Unified billing): same endpoint and token plus a `cf-aig-gateway-id` header. Cloudflare pins `typesafe/jev` to 1.13 and has no latest alias, so the plugin names `typesafe/jev-1.14.0` and needs a bump when a newer Jev ships there.

**OpenRouter routing** (`openrouterSort`): OpenRouter serves some models through several hosts (Clef-flash has four). `default` keeps your OpenRouter account routing; `latency` prefers the fastest host, `price` the cheapest.

**Custom gateway**: `customUrl` is the full endpoint URL, `customFormat` is `systemone` (the Jev/Clef request shape) or `openai` (the OpenAI Decisions shape), and `customModels` maps model names to the gateway's IDs, e.g. `jev=typesafe/jev`.

## Choosing models and providers

Each model has one **Use** option that decides whether it's asked and which provider it goes through:

| Option | Choices |
|---|---|
| Use Jev | `auto`, `off`, `typesafe`, `cloudflare`, `openrouter`, `vercel`, `opencode`, `custom` |
| Use Clef | `auto`, `off`, `cloudflare`, `openrouter`, `custom` |
| Use Clef-flash | `auto`, `off`, `cloudflare`, `openrouter`, `custom` |
| Use GPT-6 Luna | `auto`, `off`, `openai`, `cloudflare`, `openrouter`, `vercel`, `custom` |

- **`auto`** (the default): the vendor's own API when its key is set (TypeSafe for Jev, Cloudflare for Clef and Clef-flash, OpenAI for GPT-6 Luna), otherwise the first gateway with a key, in this order: OpenRouter, Vercel, Cloudflare (as a third-party model, for Jev and GPT-6 Luna), OpenCode Zen (Jev 1.13, the oldest Jev, so last), custom.
- **A provider**: the model goes only there. This is how you mix routes, e.g. Clef through Cloudflare, GPT-6 Luna through OpenAI and Jev through TypeSafe, or two models on OpenRouter and the rest elsewhere. If that provider has no key (or, for `custom`, doesn't list the model in `customModels`), the model is never sent anywhere else: `/decision-models:setup` shows it as misrouted, naming it errors with the option to fix, and asking all models skips it with a note.
- **`off`**: the model is left out whenever all models are asked (consensus, `/opinion-all`, `cheapest`). Naming it explicitly (`/opinion clef …`) still works, routed as `auto`. An OpenRouter key alone reaches all four models, so set the ones you don't want to `off`.

The choices list every provider that serves the model, whether or not you've set its key: Claude Code plugin options have a fixed list of choices, so it can't hide the ones you haven't configured. `/decision-models:setup` shows which provider each model actually uses.

Version 0.1.0 had on/off checkboxes under the same names; a saved `true` reads as `auto` and `false` as `off`, so nothing needs reconfiguring.

## Default model and consensus

These plugin options decide what Claude and `/opinion` ask:

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
- `/decision-models:stats` shows usage since install: per model and provider (calls, errors, p50/p95 latency, input tokens, cost, how often multi-model questions agreed) per source (the `ask` tool, or each automatic check) and per project folder, then the last 7 days by day, source and project. `/decision-models:stats clear` deletes the recorded calls and starts over. Cost is the actual charge where the provider reports it (OpenRouter and Vercel, which also name the host that served each call), otherwise an estimate (TypeSafe, Cloudflare and OpenAI report tokens only) from public input prices as of 2026-11-01 (jev $0.042, clef $0.24, clef-flash $0.038, gpt-6-luna $0.10 per 1M input tokens; output is free), marked `est.`; a custom-gateway model with no known price shows `unknown` and marks the total incomplete. Only numbers and the project folder Claude Code was started in are logged, to `calls.jsonl` in the plugin's data folder (`~/.claude/plugins/data/…`, removed on uninstall), never question text or inputs.
- `/decision-models:setup` shows which providers are configured and where each key comes from (never the key), tests every configured model, and shows the default.
- All four run on Haiku, not your session's model, to keep them fast and cheap.
- The question type (yes/no, choice, score) is inferred from your wording. Override it with a `yes_no:`, `choice: … —` or `score: … —` prefix (score levels lowest first).

## When Claude uses it

A short note at session start (and after `/clear` or compaction) tells Claude to prefer the decision models for yes/no, bucket and score judgments: triaging diffs, logs, test output, search hits or review findings, locating which files implement something, checking an edit against a project rule, checking a screenshot. The `consulting-decision-models` skill has the workflow.

For bulk work, the `ask` tool takes `items`: up to 500 file or image paths judged separately with the same questions in one call, returning counts per answer and the uncertain items. Write **jevify** anywhere in a prompt ("jevify the files in the last commit: which are unrelated to its subject?") to make Claude run the full bulk workflow: fix the questions before looking at the data, pre-filter, judge every unit in one batch, then read only what's flagged.

## Automatic checks

Claude rarely reaches for the `ask` tool on its own, so the plugin also runs a decision model itself at three points. Each has its own option: `off`, `cheapest` (the cheapest configured model) or a model name. Their calls show up in `/decision-models:stats` like any other.

| Option | Default | When it runs | What Claude gets |
|---|---|---|---|
| **Check commits** | cheapest | After a Bash command runs `git commit` and creates a commit (two or more files) | If a file is unrelated to the commit message (p ≥ 0.8), a note naming it, so Claude splits it into its own commit. Up to 30 files, one call each. |
| **Triage long output** | cheapest | After a Grep, Glob or Bash result of 40 lines or more | A note listing the lines that matter for your latest prompt (p ≥ 0.8). Claude still sees the full output. Up to 320 lines, 32 per call. |
| **Catch early stops** | off | When Claude ends its turn | If it stopped partway through (said there was more to do, didn't ask you anything), it's told to continue or say plainly that it's done. Never twice in a row. |

Each asks only the model its option names and ignores the consensus setting, since they run often. They do nothing when no API key is set.

**Write paths without `@`.** `@file` attaches the whole file to Claude's prompt before the model sees it, which spends the tokens this plugin exists to save. A bare path is read by the server and never enters Claude's context.

## Development

```
npm install
npm run typecheck
npm run build   # writes dist/server.js and dist/hook.js, which are committed
cd ../.. && claude --plugin-dir plugins/decision-models
```

How it runs:

- The MCP server is declared in `.claude-plugin/plugin.json` under `mcpServers`, which passes the plugin options to it as `DM_*` environment variables. It isn't in a `.mcp.json`, because Claude Code also loads a `.mcp.json` in the folder it's started from as a project config, without plugin variables, which breaks the server. Start Claude Code from the repo root, as above.
- Stats go to `calls.jsonl` in the folder Claude Code passes as `CLAUDE_PLUGIN_DATA`: `~/.claude/plugins/data/decision-models-carlesjavierre/` when installed from the marketplace, `…/decision-models-inline/` when loaded with `--plugin-dir`. Claude Code sets that variable for plugin servers itself; it isn't listed in the server's `env`, where it wouldn't be expanded.
