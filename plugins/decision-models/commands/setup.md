---
description: Check which decision-model providers are configured and test each model
model: haiku
---

Call the decision-models `status` tool once, then reply with exactly:

1. A table of providers: provider, models, `configured` or `missing`, and the key source (plugin option or env var) or, when missing, what it needs, plus the AI Gateway and the masked account ID (as given, only its last characters) when set. Never show key values.
2. A table of configured models: model, used when asking all (`enabled`: yes/no), provider it's routed to, `ok` or the error, latency. Then, if `misrouted` is present, one row per entry in it with the model and its message as the error.
3. One line with the default model and the consensus mode (off, unanimous or majority), plus the tool's note if there is one.
4. The line: To change keys, routes or the default model: `/plugin configure decision-models@carlesjavierre` (or `/plugin` → Installed → decision-models → Configure options), then restart Claude Code.

Do not add anything else.
