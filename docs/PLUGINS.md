# Client Plugin Standard (Cursor and Claude Code)

Status: v1 (2026-11). Template: `templates/plugin/`. Checked by
`scripts/audit-server.sh` (`standards.plugin` in
`config/ecosystem-policy.json`).

A plugin packages a server's MCP connection with the rules, skills, and
commands that teach an agent to use it well. It is optional per server; when
a server ships one, it follows this layout.

## Decision: the plugin lives in the server repo

```text
mcp-<name>/
├── .cursor-plugin/marketplace.json     # lists ./plugins/<brand>
├── .claude-plugin/marketplace.json     # lists ./plugins/<brand>
└── plugins/<brand>/
    ├── .cursor-plugin/plugin.json      # Cursor manifest
    ├── .claude-plugin/plugin.json      # Claude Code manifest
    ├── mcp.json                        # Cursor MCP config (Claude: .mcp.json)
    ├── .mcp.json
    ├── rules/<brand>.mdc
    ├── skills/<brand>/SKILL.md
    ├── commands/*.md                   # optional
    └── assets/icon.svg
```

Why in-repo rather than a standalone `<brand>-cursor-plugin` repo:

1. **No drift.** `enabledTools`, rules, and skills name real tools. In the
   same repo, CI and `audit-server.sh` check the plugin against the tools
   the server actually registers, and one PR changes both. A separate repo
   cannot fail when a tool is renamed.
2. **One version.** Release Please bumps the package, `server.json`, and the
   plugin manifests together (`extra-files`), so a plugin never points at a
   server version that does not exist.
3. **Propagation already targets server repos.** `server-inventory.json`,
   `propagate-templates.sh`, and the audit work per server repo. A second
   repo type would need its own inventory, CI, release, and hygiene files.
4. **One place for support.** Issues, `SECURITY.md`, and the changelog cover
   server and plugin together.
5. **The marketplaces support it.** Cursor and Claude Code both read a root
   `marketplace.json` whose entries point at `./plugins/<brand>`, the same
   layout as `cursor/plugin-template` and `mcp-automem`.

Standalone repos are the exception, for a plugin that bundles several
servers or has no server repo of its own. Name them `<brand>-cursor-plugin`
(the common industry pattern: `firecrawl-cursor-plugin`,
`n8n-cursor-plugin`, `browserstack-cursor-plugin`); the `cursor-plugin-<x>`
prefix is rare and should not be used for new repos.

## Manifest rules

- `name` is the lowercase kebab brand (`evernote`, `automem`) and matches
  the marketplace entry. `displayName`, `description`, `author`
  (Very Good Plugins), `license`, `repository`, `homepage`, `logo`, and
  `keywords` are set.
- `version` equals the server package version.
- Remote servers use `url` plus `headers`; local servers use
  `command: "npx"` with the published package. Never both in one entry.
- **Every credential is a declared variable**, referenced as `${VAR}`.
  Secret variables have no `default` and say "set in Configure; never commit"
  in their description. Optional headers use `${VAR:-}`.
- Cursor `enabledTools` lists exactly the server's canonical tools (no
  legacy aliases). The audit warns on names the server does not register.
- Rules and skills: read-first, confirm before destructive actions, never
  echo credentials, and name tools exactly as registered. Keep each file
  short; they load into context.
- Unofficial plugins for third-party brands say "Unofficial; not
  affiliated with <Brand>" in the description.

## Validation

`audit-server.sh` checks, when `plugins/` exists:

- both manifests parse and declare `name` and `version`;
- plugin versions match `package.json` / `pyproject.toml`;
- root Cursor and Claude marketplaces exist and every `source` resolves;
- every `${VAR}` used in MCP config is declared in `variables`;
- `enabledTools` ⊆ tools the server registers.

Servers should also run the same checks in their own CI (copy
`templates/plugin/scripts/validate-plugin.mjs`).
