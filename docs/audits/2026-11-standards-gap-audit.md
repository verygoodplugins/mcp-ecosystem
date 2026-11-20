# Standards Gap Audit — 2026-11

Snapshot of each server's default branch on 2026-11-20 (and `mcp-evernote`
PR #91 head `5dfcbea`) against the 2026-11 standards:
[`TOOL_DESIGN.md`](../TOOL_DESIGN.md),
[`CREDENTIALS_AND_SECURITY.md`](../CREDENTIALS_AND_SECURITY.md),
[`PLUGINS.md`](../PLUGINS.md), and the existing `STANDARDS.md` checks.
Reproduce with `./scripts/audit-server.sh <server-path>`.

Effort: **S** ≤ half a day, **M** 1–2 days, **L** 3+ days. "Managed" means
the fix ships automatically through `propagate-templates.sh` once a write
propagation is dispatched; it needs no hand edits.

## Summary

| Server                                     | Tools (canonical)                 | Annotations               | Remote contract                                                         | Credentials / docs                                                                    | Plugin                                                     | Existing audit errors                                                                                                           | Effort                    |
| ------------------------------------------ | --------------------------------- | ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| mcp-evernote (PR #91)                      | 15 ✅ (+14 hidden legacy aliases) | ❌ none declared          | ✅ all except `/health` (has `/healthz`)                                | ✅                                                                                    | Standalone `cursor-plugin-evernote`; no Claude manifest    | ci `merge_group`, dependabot-auto-merge, pr-title (managed); `console.log` flagged in `auth-standalone.ts` CLI (false positive) | **M**                     |
| mcp-automem                                | 6 ✅                              | ✅                        | n/a (remote is the AutoMem service sidecar)                             | README lacks Configuration + Security headings                                        | In-repo ✅; root `.cursor-plugin/marketplace.json` missing | pr-title (managed); stdout writes in `src/` to triage                                                                           | **S**                     |
| mcp-freescout                              | 9 ✅                              | ✅                        | stdio only                                                              | `.env.example` missing; README lacks Security                                         | none                                                       | ci `merge_group` (managed)                                                                                                      | **S**                     |
| mcp-pirsch                                 | 4 ✅                              | partial                   | stdio only (candidate)                                                  | README lacks Security                                                                 | none                                                       | none                                                                                                                            | **S**                     |
| mcp-local-wp                               | 5 ✅                              | partial                   | n/a (local only)                                                        | `.env.example` missing                                                                | none                                                       | none                                                                                                                            | **S**                     |
| robinhood-mcp                              | 15 ✅                             | ❌                        | stdio only                                                              | README lacks Support; `mcp>=0.4.0` pin; username/password/TOTP need Keychain guidance | none                                                       | dependabot-auto-merge, ci `merge_group` (managed)                                                                               | **S**                     |
| mcp-toggl                                  | 16 (target 15)                    | `destructiveHint` missing | not on `main` (SELF_HOSTING listed it as ready)                         | README lacks Support                                                                  | none                                                       | ci `merge_group` (managed)                                                                                                      | **S** (+**M** for remote) |
| mcp-edd                                    | 16 (target 15)                    | ❌                        | stdio only (candidate)                                                  | `.env.example` missing; SDK `^1.25.1`                                                 | none                                                       | ci `merge_group`, dependabot-auto-merge, pr-title (managed)                                                                     | **M**                     |
| streamdeck-mcp                             | 23 ❌ (ceiling 20)                | partial                   | n/a (local device)                                                      | README lacks Configuration + Security; `.env.example`, `AGENTS.md` missing            | none                                                       | ci `merge_group` (managed)                                                                                                      | **M**                     |
| whatsapp-mcp                               | 17 (target 15)                    | partial                   | ❌ HTTP exists with no MCP auth, health, rate limit, or Host validation | README lacks Support                                                                  | none                                                       | pr-title (managed)                                                                                                              | **M**                     |
| mcp-wp (development, propagate off)        | 44 ❌                             | ❌                        | stdio only                                                              | README lacks Support; stack traces may reach output; SDK `^1.4.1`                     | none                                                       | 13 errors: LICENSE, lockfile, lint/coverage scripts, release + security workflows, `mcpName`, …                                 | **L**                     |
| mcp-wise (not in inventory, no git remote) | 3 ✅                              | ✅                        | stdio only                                                              | `.env.example` missing; README lacks Security                                         | none                                                       | ci `merge_group`; package `files`/`bin`                                                                                         | **S** once it has a repo  |

## Per-server notes and consolidation ideas

- **mcp-evernote** — the reference. Add `title`/`readOnlyHint`/`destructiveHint`
  to all 15 tools (most important gap, since every other server will copy
  it), serve `/health` next to `/healthz`, and move `cursor-plugin-evernote`
  into `plugins/evernote/` with a Claude manifest and both root marketplaces.
  A GHCR image is optional; the daemon pattern is documented in SELF_HOSTING.
- **mcp-automem** — add the root Cursor marketplace (the Claude one exists),
  rename/add `## Configuration` and `## Security` README headings, and triage
  the `console.log`/`process.stdout.write` hits (CLI paths may be fine). The
  Cursor plugin already omits `delete_memory` from `enabledTools`, which is
  the right call for a destructive tool.
- **mcp-toggl** — fold `toggl_cache_stats`/`toggl_clear_cache`/`toggl_warm_cache`
  into `toggl_cache` with `action` (16 → 14). Remote: port the Evernote
  `http-server.ts` pattern rather than writing a new one.
- **mcp-edd** — merge `edd_get_stats`, `_by_date`, `_by_preset`, `_by_product`
  into `edd_get_stats` with `by`; merge the four discount tools into
  `edd_discounts` with `action`/`code` (16 → ~10). All read-only, so the
  annotations are trivial.
- **streamdeck-mcp** — group by noun: `streamdeck_page` (list/read/write/
  create/delete/switch), `streamdeck_button` (get/set/set_many/clear),
  `streamdeck_device` (connect/disconnect/list/info/brightness/restart)
  (23 → ~10). `streamdeck_delete_page` should keep a backup or be marked
  destructive.
- **whatsapp-mcp** — the HTTP transport must not leave loopback until it has
  `WHATSAPP_HTTP_CALLER_KEYS`, `/health`, rate limits, and FastMCP
  `TransportSecuritySettings` Host validation. Consolidate contact/chat
  lookups (`get_contact`/`search_contacts`, `get_chat`/`list_chats`/
  `get_direct_chat_by_contact`/`get_contact_chats`) and media
  (`download_media`/`view_media`) (17 → ~12). Send tools are destructive and
  open-world.
- **robinhood-mcp** — read-only, so annotations are mechanical. Raise the SDK
  floor and document Keychain storage for the TOTP secret.
- **mcp-wp** — the largest gap. Either invest (v2 `registerTool` migration,
  44 → ~12 tools such as `wp_content`, `wp_media`, `wp_terms`, `wp_users`,
  `wp_comments`, `wp_plugins` with `action`; WordPress trash by default) or
  mark it unmaintained. Decision needed before any work.
- **mcp-wise** — a local-only repo with an unpushed inventory branch
  (`mcp-ecosystem-add-mcp-wise`). Decide whether it is published before it
  joins the rollout.

## Proposed rollout order

1. **Merge this standard** (docs, policy, audit, templates). Merging runs a
   dry-run propagation only.
2. **Dispatch write propagation** (`Propagate Templates`, `dry_run=false`).
   This fixes every "managed" error above (`merge_group`, pr-title,
   dependabot-auto-merge) and rolls the new `SECURITY.md` credential section
   to all 10 propagating servers in one pass.
3. **mcp-evernote** — finish it as the reference (annotations, `/health`,
   plugin fold-in) so later ports copy a compliant example.
4. **S-effort servers in one sweep**: automem, freescout, pirsch, local-wp,
   robinhood, toggl (docs headings, `.env.example`, annotations).
5. **Consolidations**: edd, then streamdeck (tool merges with mapping
   tables and one-release legacy aliases).
6. **Remote ports** using the Evernote HTTP module: whatsapp (security fix
   first), then toggl, then pirsch/edd/freescout as demand appears.
   Consider extracting the HTTP/auth/rate-limit module into a shared
   package at this point so the next protocol change lands once.
7. **mcp-wp and mcp-wise** after their keep/publish decisions.
