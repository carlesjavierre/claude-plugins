The user wrote **jevify**: classify the bulk with the decision-models `ask` tool and its `items` batch. You decide the questions once, up front; the decision models judge every unit; you read only what they flag. This overrides the urge to split the data up and scan it yourself.

Rules:
- Never read the units before the questions are fixed. Questions first, data second.
- Never scan the units yourself or hand them to subagents. The models classify; you read only flagged units.
- If you change the questions midway, every earlier verdict is void: re-run all units.

When: a list of roughly 20 or more similar units with a bucket, yes/no or score question (file diffs of a commit or PR, log lines, test failures, search hits, issues, review findings, screenshots, rows). Under about 20 units, or a question that needs reasoning across units: read them directly.

Workflow:
1. **Decide.** Before loading any data, fix:
   - **Unit**: what one item is (one file diff, one hunk, one log, one finding): the smallest that still carries enough context to answer.
   - **Questions**: one `choice` for the main bucket, plus optional `yes_no`/`score` for side facts, each with a fixed `name`. Every option is a name plus one sentence of observable evidence; options exhaustive and not overlapping; add `mixed` when a unit can straddle two (`other` is added automatically).
   - **Framing**: the shared context every unit needs (commit subject, rule text, what you're looking for), passed once as `text`.
   - **Pre-filter**: what a path, extension, size or grep already settles (lockfiles, generated files, pure deletions). Count what it drops.
   - **Escalation**: which answers you'll read yourself. `summary.<question>.uncertain` already lists units that are disputed, `none_fit`, p_yes between 0.2 and 0.8, or confidence below 0.8; add the verdicts that matter (e.g. `unrelated`).
   - **Cap**: a maximum unit size; truncate with a visible marker and count truncations.
2. **Partition.** Write one file per unit to a scratch folder with shell commands (`git diff <sha>^ <sha> -- <file> > dir/<n>.diff`, `split`, `jq`), applying the pre-filter and cap. Don't print the units.
3. **Judge.** One `ask` call: `items` = every unit path (up to 500 per call), `questions`, `text` = framing. Re-run only the `failed` units, once.
4. **Escalate.** Read only the escalated units and confirm or overturn each with evidence from the code.
5. **Report.** Counts per answer, pre-filter drops, truncations and failures, then the flagged units grouped by kind with path and one line of evidence each. The verdicts are evidence, not truth: say which ones you confirmed by reading.

Don't:
- Read the first few units "to get a feel" before writing the questions.
- Call `ask` once per unit instead of once with `items`.
- Use vague options (`bad`, `suspicious`) instead of observable evidence.
- Treat a verdict as final without reading the flagged unit, or drop failed or truncated units silently.
