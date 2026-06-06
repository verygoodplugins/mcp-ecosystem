# AGENTS.md

This file provides guidance to coding agents (Claude Code, Cursor, Codex, and others) when working with code in this repository. `CLAUDE.md` imports it verbatim via `@AGENTS.md`.

## Repository Purpose

This is the **mcp-ecosystem** repository - shared infrastructure, templates, and standards for Very Good Plugins MCP servers. It provides:

- Complete project scaffolding for TypeScript and Python MCP servers
- GitHub Actions workflow templates (force-copied baselines and profile-aware managed files)
- Audit, scaffolding, and template-propagation scripts
- Publishing checklists for npm, PyPI, and the MCP Registry
- Coding standards documentation
- A machine-readable policy (`config/ecosystem-policy.json`) and inventory (`server-inventory.json`)

This repository does NOT contain MCP server implementations. Individual servers live in separate repos (mcp-automem, mcp-freescout, etc.).

## Reference Implementation

**Use [mcp-freescout](https://github.com/verygoodplugins/mcp-freescout) as the reference implementation** for patterns not fully documented here. When in doubt about how something should be structured, check mcp-freescout first.

## Common Commands

```bash
# Create a new MCP server from templates
./scripts/create-server.sh typescript myservice "My service integration"
./scripts/create-server.sh python weather "Weather forecasts and alerts"

# Audit an MCP server against VGP standards
./scripts/audit-server.sh ../mcp-freescout

# Apply (force-copy) baseline templates to an existing server
./scripts/apply-templates.sh typescript ../mcp-freescout
./scripts/apply-templates.sh python ../mcp-ical --force

# Update server inventory from filesystem
./scripts/sync-inventory.sh
./scripts/sync-inventory.sh --dry-run

# Update README links with UTM tracking
./scripts/update-utm-links.sh ../mcp-freescout

# Apply repo-level GitHub defaults (e.g. allow_auto_merge)
./scripts/configure-github-defaults.sh ../mcp-freescout

# Preview/propagate template-sync PRs to downstream repos (requires gh + token)
./scripts/propagate-templates.sh --server mcp-pirsch --dry-run

# Generate profile-aware managed workflows/config into a downstream repo
./scripts/render-managed-files.mjs whatsapp-mcp ../whatsapp-mcp

# Update managed dependency baselines from parsed JSON/TOML
./scripts/sync-template-baseline.mjs whatsapp-mcp ../whatsapp-mcp

# Block bad syncs before opening a PR
./scripts/validate-sync.mjs whatsapp-mcp ../whatsapp-mcp

# Describe a server's resolved profiles from the inventory
./scripts/describe-server.mjs mcp-pirsch
```

## Testing

This repo's own test suite uses Node's built-in test runner (no root `package.json`):

```bash
node --test scripts/tests/*.mjs
```

Tests live in `scripts/tests/` and cover the inventory/policy logic, the
template-baseline sync, sync validation, and the apply-templates follow-ups.

## Architecture

```
mcp-ecosystem/
├── README.md                       # Public overview + server inventory table
├── STANDARDS.md                    # TypeScript/Python coding standards
├── PUBLISHING.md                   # npm/PyPI/MCP Registry publishing checklist
├── server-inventory.json           # Machine-readable list of all VGP MCP servers + capabilities
├── config/
│   └── ecosystem-policy.json       # Machine-readable CI/release/security policy + repo defaults
├── docs/
│   └── SELF_HOSTING.md
├── templates/
│   ├── typescript/
│   │   ├── .github/                # CI, release-please, security, dependabot, PR/issue templates
│   │   ├── src/index.ts.template   # Server skeleton
│   │   ├── tests/index.test.ts.template
│   │   ├── package.json.template   # Full package.json
│   │   ├── server.json.template    # MCP Registry manifest
│   │   ├── manifest.json.template  # Desktop extension manifest
│   │   ├── README.md.template
│   │   ├── CLAUDE.md.template
│   │   ├── LICENSE.template
│   │   ├── tsconfig.json           # Standard config
│   │   ├── eslint.config.mjs       # ESLint 9 flat config
│   │   ├── .prettierrc             # Prettier config
│   │   └── vitest.config.ts        # Test config
│   └── python/
│       ├── .github/                # CI, release, security workflows + templates
│       ├── src/mcp_name/           # Package skeleton (__init__.py, server.py)
│       ├── tests/                  # Test skeleton
│       ├── pyproject.toml.template # Full config
│       ├── server.json.template
│       ├── README.md.template
│       ├── CLAUDE.md.template
│       └── LICENSE.template
└── scripts/
    ├── create-server.sh            # Scaffold new server from templates
    ├── audit-server.sh             # Validate against standards
    ├── apply-templates.sh          # Force-copy baseline workflows/config into a server
    ├── configure-github-defaults.sh # Apply repo-level GitHub defaults
    ├── propagate-templates.sh      # Open/update template-sync PRs in downstream repos
    ├── sync-inventory.sh           # Auto-update server inventory
    ├── update-utm-links.sh         # Add UTM tracking to README links
    ├── describe-server.mjs         # Print a server's resolved profiles
    ├── render-managed-files.mjs    # Generate profile-aware managed workflows/config
    ├── sync-template-baseline.mjs  # Update managed dependency baselines
    ├── validate-sync.mjs           # Preflight generated diffs before PRs
    ├── lib/                        # Shared modules (ecosystem-config.mjs, validate-sync.mjs, ...)
    └── tests/                      # node --test suite for the scripts above
```

## Creating a New MCP Server

The fastest way to create a new server (see `scripts/create-server.sh:3` for usage):

```bash
./scripts/create-server.sh typescript myservice "Brief description of what it does"
```

This will:

1. Create `../mcp-myservice/` with full project structure
2. Substitute all placeholders (`{name}`, `{description}`, etc.)
3. Initialize a git repository (`git init`)
4. Install npm dependencies (TypeScript servers)

Then:

1. `cd ../mcp-myservice`
2. Edit `src/index.ts` to implement your tools
3. Update `server.json` with your tools list
4. Run `npm test` to verify
5. Commit: `git commit -m "feat: initial implementation"`

## Key Standards (from STANDARDS.md)

**TypeScript servers:**

- Node.js ≥22.0.0 (template `engines` pin `>=24.0.0`), ES2022, strict mode
- MCP SDK `@modelcontextprotocol/sdk ^1.25.1`
- Package naming: `@verygoodplugins/mcp-{name}`
- MCP Registry name: `io.github.verygoodplugins/mcp-{name}`
- Required: `mcpName` field in package.json
- Testing: Vitest, ≥50% coverage (target ≥80%)
- Release automation: release-please with OIDC Trusted Publishing

**Python servers:**

- Python ≥3.11, pyproject.toml
- Required: `[tool.mcp]` section in pyproject.toml
- Testing: pytest with asyncio
- Linting: ruff

**Required files for all servers:**

- README.md (with Support section + orange heart 🧡 footer)
- LICENSE, CHANGELOG.md, CLAUDE.md
- server.json (MCP Registry manifest)
- .github/workflows/ci.yml, security.yml, release\*.yml
- .github/dependabot.yml

**README Footer (Required):**

```markdown
## Support

For issues, questions, or suggestions:

- [Open an issue on GitHub](https://github.com/verygoodplugins/mcp-{name}/issues)
- [Contact Very Good Plugins](https://verygoodplugins.com/contact/?utm_source=github)

---

Built with 🧡 by [Very Good Plugins](https://verygoodplugins.com/?utm_source=github)
```

## Server Inventory

`server-inventory.json` tracks all VGP MCP servers with their publication
status, repo capabilities (`packagePath`, `ciProfile`, `releaseProfile`,
`securityProfile`, `templateTier`, `docsDispatch`, `propagate`), and the
profiles consumed by the managed-file generators.

```bash
# Auto-update from filesystem
./scripts/sync-inventory.sh

# Preview changes without writing
./scripts/sync-inventory.sh --dry-run
```

## Source Of Truth

`mcp-ecosystem` is the source of truth for shared MCP server workflows,
config, and baseline dependency versions:

- Update templates and shared baselines here first, then merge to `main`.
- `config/ecosystem-policy.json` is the machine-readable source for shared
  CI/release/security policy and repo defaults.
- `.github/workflows/propagate-templates.yml` opens/updates `chore/template-sync`
  PRs in downstream repos from `server-inventory.json`. It requires an
  org/repo secret named `VGP_TEMPLATE_SYNC_TOKEN`.
- `scripts/render-managed-files.mjs` generates profile-aware managed
  workflows/config instead of force-copying one shape into every repo.
- `scripts/sync-template-baseline.mjs` updates managed dependency baselines
  and reports when lockfiles need regeneration.
- `scripts/validate-sync.mjs` blocks PR creation when the generated diff is
  incompatible with the repo profile.
- Org rulesets are the canonical branch-protection layer; repo-level GitHub
  booleans like `allow_auto_merge` are applied with
  `scripts/configure-github-defaults.sh`.

## Publishing Workflow

**New server:**

1. Create: `./scripts/create-server.sh typescript {name} "description"`
2. Implement tools in `src/index.ts`
3. Update `server.json` with tools list
4. Publish to npm: `npm publish`
5. Configure Trusted Publishing on npm
6. Submit to MCP Registry (see PUBLISHING.md)

**Existing server:**

1. Apply templates: `./scripts/apply-templates.sh typescript ../mcp-{name}`
2. Audit: `./scripts/audit-server.sh ../mcp-{name}`
3. Fix any errors/warnings
4. Update `server-inventory.json`

See [PUBLISHING.md](./PUBLISHING.md) for the complete checklist.

## Commit Message Format

Use conventional commits for release-please:

- `feat:` → minor version bump
- `fix:` → patch version bump
- `feat!:` or `BREAKING CHANGE:` → major version bump
- `chore:`, `docs:` → no version bump
