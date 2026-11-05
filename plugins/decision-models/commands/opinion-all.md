---
description: Ask every configured decision model a question and compare their answers
argument-hint: "[yes_no:|choice: a, b, c —|score: low, mid, high —] <question> [paths]"
model: haiku
---

Ask every configured decision model this question and relay their answers. Do not add your own opinion.

Arguments: $ARGUMENTS

1. **Paths**: words that are file paths (with or without a leading `@`) go to `files`, or to `images` for png/jpg/jpeg/webp. Make them absolute. Don't read the files yourself.
2. **Type**: if the question starts with `yes_no:`, `choice: <options> —` or `score: <levels, lowest first> —`, use that. Otherwise infer it: a yes/no question is `yes_no`; "A, B or C?" is `choice` with those options; "how much / rate / how severe" is `score` with levels you derive from the wording (lowest first). Whatever remains is the `question`.
3. Call the `ask` tool once with `models: "all"`.
4. Reply with exactly:
   - One line: the question type, plus the options or levels used.
   - A table with one row per model: model, provider (with the `host` in parentheses when present, e.g. `openrouter (DeepInfra)`), answer (for choice also show `none_fit` when true), probability or confidence, input tokens, latency (output tokens are free on these models, don't show them). For choice, add a column with every option's probability as a percentage, highest first (`billing 82% · technical 12% · sales 6%`), and a column with `fit_probability` as a percentage (how likely any option fits).
   - If more than one model answered: `Agreed: yes/no (<agreement_rule>, votes: yes 2 · no 1)` using the result's `agreement_rule` and `votes`, and the verdict when agreed. If `partial`, list the failed models and their errors.
