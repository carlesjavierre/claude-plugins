# Claude Plugins

Custom [Claude Code](https://code.claude.com) plugins by Carles Javierre.

## Install

```
/plugin marketplace add carlesjavierre/claude-plugins
/plugin install <plugin>@carlesjavierre
```

## Update

```
/plugin marketplace update carlesjavierre
```

Then update the plugin from `/plugin`. To get updates automatically, enable auto-update for the `carlesjavierre` marketplace in the `/plugin` menu (it's off by default for third-party marketplaces).

Each plugin is versioned independently. To hear about new versions, watch this repo with **Watch → Custom → Releases**; every release is tagged `<plugin>/v<version>` and lists that plugin's changes.

## Plugins

- [**decision-models**](plugins/decision-models): ask cheap decision models (Jev, Clef, GPT-6 Luna) typed questions for calibrated yes/no, choice and score answers, alone or as a consensus. Adds `/opinion`, `/opinion-all`, `/decision-models:setup` and `/decision-models:stats`.

  ```
  /plugin install decision-models --marketplace carlesjavierre/claude-plugins
  ```

## License

MIT
