# Claude Plugins

A Claude Code plugin marketplace named `carlesjavierre`. Users install with `/plugin install <plugin>@carlesjavierre`.

## Adding a plugin

1. Create `plugins/<name>/` (short kebab-case, no `claude-` prefix).
2. Add `plugins/<name>/.claude-plugin/plugin.json` with `name`, `description` and `"version": "0.1.0"`. Add only the parts the plugin uses: `skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json`.
3. Add an entry to `.claude-plugin/marketplace.json` with `name`, `description` and `"source": "./plugins/<name>"`. Never put `version` there: `plugin.json` silently overrides it.
4. Add the plugin to the list in `README.md`.

## Versioning

- Each plugin has its own semver in its `plugin.json`. There is no marketplace-wide version.
- Bump it by hand in the same commit as any change under `plugins/<name>/`. Claude Code only refreshes a cached plugin when the version changes, so CI fails an unbumped change.
- On push to `main`, CI tags each newly bumped plugin as `<name>/v<version>` and creates a GitHub Release with that plugin's commit subjects since its previous tag. Write commit subjects for users to read.

## Before pushing

```
claude plugin validate .
claude plugin validate --strict plugins/<name>
```
