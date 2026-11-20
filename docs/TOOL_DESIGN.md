# Tool Design Standard

Status: v1 (2026-11). Applies to every server in `server-inventory.json`.
Machine-readable thresholds live in `config/ecosystem-policy.json` →
`standards.toolDesign` and are checked by `scripts/audit-server.sh`.

The rule in one line: **extend an existing tool with a parameter or an
`action` before adding a new tool, and keep every description short.**

Every tool costs context in every client on every turn, and overlapping tools
make models pick the wrong one. A small, well-shaped surface is the product.

## Budget

| Metric                        | Target | Audit warns above |
| ----------------------------- | ------ | ----------------- |
| Tools per server              | ≤ 15   | 20                |
| Tool description (characters) | ≤ 300  | 600               |

Over budget is allowed only with a written reason in the server's
`AGENTS.md` (for example a large, genuinely disjoint API surface).

## Rules

1. **Consolidate by noun, not by verb.** One tool per resource, with an
   `action` enum (`get | list | create | update | delete | restore`) or a
   mode parameter, when the actions share identifiers and auth. Split only
   when annotations differ (see rule 4).
2. **Extend, don't fork.** A new capability on an existing resource is a new
   optional parameter (`guids[]` for batch, `addTags`/`removeTags` for
   partial edits, `as: "text" | "metadata" | "binary"` for formats), not a
   new tool. Reference: `mcp-evernote` 2.x consolidated 29 tools to 15 this
   way without losing a feature.
3. **Lean descriptions.** First sentence says what it does and when to use
   it. Put parameter detail in the schema `description`s, not the tool
   description. No marketing, no examples longer than one line, no
   duplicated text across tools.
4. **Annotations are mandatory and honest.** Every tool declares
   `title`, `readOnlyHint`, and `destructiveHint` (plus `idempotentHint`
   and `openWorldHint` where meaningful). A tool with any mutating action
   is `readOnlyHint: false`. If one action is destructive and the others
   are not, either split the destructive action into its own tool or mark
   the whole tool `destructiveHint: true`; never under-report.
5. **Trash, not hard delete.** Delete actions move to the provider's trash
   or an archived state and say so in the description. A permanent delete
   needs an explicit opt-in parameter (`permanent: true`) **and** a server
   env flag (`<SERVICE>_ALLOW_PERMANENT_DELETE=true`), defaults off. Offer a
   `restore` action where the provider supports it.
6. **Drafts for outbound actions.** Tools that send money, messages, or
   email default to creating a draft or a pending item (see `mcp-wise`,
   `mcp-freescout` drafts). Sending is a separate, explicitly destructive
   step.
7. **Stable names.** `<service>_<noun>` or `<service>_<verb>_<noun>`,
   snake_case, prefixed with the service. Renames and merges keep the old
   name as a hidden alias for one minor release behind
   `<SERVICE>_LEGACY_TOOLS=true`, then drop it in the next major.
8. **Bounded output.** Paginate (`limit`, `cursor`), cap response size, and
   return summaries by default with opt-in detail. Private fields are
   opt-in.
9. **v2 contract.** Zod input and output schemas, `structuredContent` plus a
   matching JSON text block, and `isError: true` for expected failures (see
   STANDARDS.md → Tool Schema Best Practices).

## Mapping table on every consolidation

When a PR merges or renames tools, its description must include a table:

| Old tool           | New call                        |
| ------------------ | ------------------------------- |
| `x_get_thing_text` | `x_get_thing` with `as: "text"` |

and `CHANGELOG.md` must carry the same mapping under the release.

## Review checklist

- [ ] Could this be a parameter or `action` on an existing tool?
- [ ] Tool count still within budget?
- [ ] Description ≤ 300 characters, first sentence says when to use it?
- [ ] Annotations match the most dangerous action?
- [ ] Deletes go to trash; permanent delete double opt-in?
- [ ] Plugin `enabledTools`, rules, and skills updated (see `docs/PLUGINS.md`)?
