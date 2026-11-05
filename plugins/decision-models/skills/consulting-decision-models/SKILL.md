---
name: consulting-decision-models
description: Default tool for every yes/no, classification, ranking or score judgment over content, via the decision-models `ask` tool (Jev, Clef, GPT-6 Luna), at a fraction of your token cost. Use it before reading material in full to judge it, before spawning a subagent to "review" or "scan", and before a step that is costly to undo. Common cases - triaging a diff ("is this file's change unrelated to the commit?"), log or test output ("does this show a regression?"), search hits, issues or review findings ("which bucket?"); locating which of several files implements a behavior; checking your own edit against a project rule; checking a screenshot ("does the UI show an error?"); a second opinion before deleting, pushing or migrating.
---

# Consulting decision models

Decision models answer typed questions (yes_no, choice, score) about content with calibrated probabilities. They are cheap and fast: prefer them over reading, reasoning through, or delegating any judgment that is a yes/no, a bucket or a score. You decide what to ask; they process the bulk; you read only what they flag.

## Reach for it when

- **Triage a diff.** Per file: does this change belong to the stated refactor or commit (`belongs` / `mixed` / `unrelated`)? Is it only formatting or renames? Does it change runtime behavior?
- **Triage output.** A test run, build log or command output saved to a file: did it fail, which failure kind, is this a regression or a flaky/environment error?
- **Bucket a list.** Search hits, issues, review findings, TODOs, log lines, dependency updates: which category, which are relevant to the task, how severe.
- **Locate.** Which of these candidate files (from `ls`, `glob` or a broad grep) implements the behavior you're looking for? Ask a `score` or yes_no per file instead of opening them all; read the top ones.
- **Check your own work against a rule.** After an edit: does it violate this CLAUDE.md or project rule (quote the rule)? Does this commit message match the repo's convention?
- **Look at an image.** A screenshot or rendered page: does it show an error, an empty state, a broken layout?
- **Second opinion.** Before something costly to undo (deleting, migrating, pushing, sending), ask the judgments the decision depends on, as one input to your call.

Skip it when the answer needs reasoning across many items at once, exact facts (arithmetic, versions, lookups), or anything a grep, a test, the type checker or the code settles for certain. Never let it alone decide a destructive or outward-facing action.

## Workflow

1. **Rubric before data.** Write the questions before reading the material, so the rubric isn't shaped by the first items you see. Fix the unit (one file diff, one log, one finding). If you change the rubric midway, re-ask everything already judged.
2. **Pre-filter deterministically.** Drop what a path, extension, size or grep already settles; don't spend a question on it. Note how many you dropped.
3. **Ask.** Pass content as paths, never pasted into `text`: pasting makes you write it out at your own token cost. Save command output to a file first.
   - One unit: `files`/`images` with every question about it in one call.
   - Many similar units: write one file per unit (`git diff <sha>^ <sha> -- <file> > dir/<n>.diff`) and make one call with `items` = all the paths, the shared framing (commit subject, rule text) in `text`, and named questions. Re-run only the `failed` ones. When the user writes "jevify", follow the full bulk workflow that gets injected.
4. **Escalate.** Decide up front which answers you'll check yourself: the verdicts that matter (e.g. `unrelated`), uncertain ones (yes_no probability 0.2–0.8, confidence < 0.8), `none_fit`, disagreements, errors. With `items`, `summary.<question>.uncertain` lists the uncertain ones already. Read only those units and confirm or overturn each with evidence.
5. **Report.** Counts per verdict, what the pre-filter dropped, then the flagged items with one line of evidence each. Say which verdicts you confirmed by reading; the rest are the models' word, not yours.

## Writing questions

- yes_no: phrase it so that a true answer means yes. No output-format instructions.
- choice: descriptive option names (`unrelated`, not `C`), each followed by one sentence of observable evidence (`unrelated: no hunk relates to the stated refactor`). Options must not overlap; add a `mixed` option when a unit can straddle two. `other` is added automatically.
- score: ordered levels, lowest first, each a concrete description.
- Ask the judgments a decision depends on ("does it touch auth?", "does it change a public API?") and combine them yourself, rather than asking the model to decide ("should this be merged?").
- Give each question the framing it needs: the commit subject, the rule's text, what you're looking for.

## Reading the answer

- Act on it when it is confident (yes_no probability below 0.2 or above 0.8, choice/score confidence above 0.8) and, with several models, `agreed` is true. `agreement_rule` says whether that took every model (`unanimous`) or more than half (`majority`); with a majority, mention the dissenting model if the call matters.
- In between, or when `agreed` is false: investigate yourself (read the material, run the check) or ask the user. A disagreement is the signal; don't pick a side.
- `none_fit: true` on a choice means none of the options fits: ignore the pick and rethink the options.
- `partial: true` means some models failed; the answer rests on fewer models than configured. Say so if it matters.

## Anti-patterns

- Reading the first few items "to get a feel" before writing the questions.
- Spawning subagents to scan or review items one by one: they read; the decision models classify.
- One question per call when several questions share the same input, or one call per unit instead of one call with `items`.
- Vague options (`bad`, `suspicious`) instead of observable evidence.
- Treating a verdict as final without reading the flagged unit, or dropping errored items silently instead of counting them.
