# Plugin template

Copy into a server repo root, then replace placeholders and rename
`plugins/BRAND` and `skills/BRAND` to the brand slug. See `docs/PLUGINS.md`.

| Placeholder     | Example                                  |
| --------------- | ---------------------------------------- |
| `{brand}`       | `evernote` (kebab-case plugin name)      |
| `{Brand}`       | `Evernote` (display name)                |
| `{name}`        | `evernote` (server repo is `mcp-{name}`) |
| `{SERVICE}`     | `EVERNOTE` (env var prefix)              |
| `{version}`     | server package version                   |
| `{description}` | one sentence                             |

The template shows the remote (Streamable HTTP + caller key) shape. For a
local stdio server, replace `url`/`headers` with
`"command": "npx", "args": ["-y", "@verygoodplugins/mcp-{name}"]` and pass
credentials through `env`.

Add the plugin manifests to `release-please-config.json` `extra-files` so
their `version` moves with the package.
