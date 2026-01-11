# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This is the **mcp-ecosystem** repository - shared infrastructure, templates, and standards for Very Good Plugins MCP servers. It provides:
- Complete project scaffolding for TypeScript and Python MCP servers
- GitHub Actions workflow templates
- Audit and template-application scripts
- Publishing checklists for npm, PyPI, and MCP Registry
- Coding standards documentation

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

# Apply workflow templates to an existing server
./scripts/apply-templates.sh typescript ../mcp-freescout
./scripts/apply-templates.sh python ../mcp-ical --force

# Update server inventory from filesystem
./scripts/sync-inventory.sh
./scripts/sync-inventory.sh --dry-run

# Update README links with UTM tracking
./scripts/update-utm-links.sh ../mcp-freescout
```

## Architecture

```
mcp-ecosystem/
├── templates/
│   ├── typescript/
│   │   ├── .github/                # CI, release-please, security workflows
│   │   ├── src/index.ts.template   # Server skeleton
│   │   ├── package.json.template   # Full package.json
│   │   ├── tsconfig.json           # Standard config
│   │   ├── eslint.config.mjs       # ESLint 9 flat config
│   │   ├── .prettierrc             # Prettier config
│   │   └── vitest.config.ts        # Test config
│   └── python/
│       ├── .github/                # CI, release, security workflows
│       ├── src/mcp_name/           # Package skeleton
│       ├── pyproject.toml.template # Full config
│       └── tests/                  # Test skeleton
├── scripts/
│   ├── create-server.sh            # Scaffold new server from templates
│   ├── audit-server.sh             # Validate against standards
│   ├── apply-templates.sh          # Update existing server workflows
│   ├── sync-inventory.sh           # Auto-update server inventory
│   └── update-utm-links.sh         # Add UTM tracking to links
├── server-inventory.json           # Machine-readable list of all VGP MCP servers
├── STANDARDS.md                    # TypeScript/Python coding standards
└── PUBLISHING.md                   # npm/PyPI/MCP Registry publishing checklist
```

## Creating a New MCP Server

The fastest way to create a new server:

```bash
./scripts/create-server.sh typescript myservice "Brief description of what it does"
```

This will:
1. Create `../mcp-myservice/` with full project structure
2. Substitute all placeholders (`{name}`, `{description}`, etc.)
3. Initialize git repository
4. Install npm dependencies

Then:
1. `cd ../mcp-myservice`
2. Edit `src/index.ts` to implement your tools
3. Update `server.json` with your tools list
4. Run `npm test` to verify
5. Commit: `git commit -m "feat: initial implementation"`

## Key Standards (from STANDARDS.md)

**TypeScript servers:**
- Node.js ≥18, ES2022, strict mode
- MCP SDK ^1.25.1
- Package naming: `@verygoodplugins/mcp-{name}`
- MCP Registry name: `io.github.verygoodplugins/mcp-{name}`
- Required: `mcpName` field in package.json
- Testing: Vitest, ≥50% coverage
- Release automation: release-please with OIDC Trusted Publishing

**Python servers:**
- Python ≥3.11, pyproject.toml
- Required: `[tool.mcp]` section in pyproject.toml
- Testing: pytest with asyncio
- Linting: ruff

**Required files for all servers:**
- README.md (with Support section + orange heart 🧡 footer)
- LICENSE, CHANGELOG.md, CLAUDE.md
- server.json (MCP Registry manifest, 2025-12-11 schema)
- .github/workflows/ci.yml, security.yml, release*.yml
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

The `server-inventory.json` tracks all VGP MCP servers with their publication status, CI/CD state, and test coverage.

```bash
# Auto-update from filesystem
./scripts/sync-inventory.sh

# Preview changes without writing
./scripts/sync-inventory.sh --dry-run
```

## Publishing Workflow

**New server:**
1. Create: `./scripts/create-server.sh typescript {name} "description"`
2. Implement tools in `src/index.ts`
3. Update `server.json` with tools list
4. Publish to npm: `npm publish`
5. Configure Trusted Publishing on npm
6. Submit to MCP Registry: `~/mcp-registry/bin/mcp-publisher publish server.json`

**Existing server:**
1. Apply templates: `./scripts/apply-templates.sh typescript ../mcp-{name}`
2. Audit: `./scripts/audit-server.sh ../mcp-{name}`
3. Fix any errors/warnings
4. Update `server-inventory.json`

## Codex Auto-Fix

All MCP servers include an optional `auto-fix.yml` workflow that uses [OpenAI Codex](https://developers.openai.com/codex/github-action) to automatically fix CI failures.

**How it works:**
1. CI fails (tests, lint, type errors)
2. Auto-fix workflow triggers automatically
3. Codex analyzes failures + CodeRabbit comments
4. Makes surgical fixes and commits them
5. Uses `[skip ci]` to prevent loops

**To enable:**
- Ensure `CODEX_AUTH_JSON` org secret is set (already configured)
- Workflow triggers automatically on CI failure
- Or run manually: Actions → Auto-Fix with Codex → Run workflow

**To customize:**
- Edit `.github/codex/prompts/fix-ci.md` in your repo
- Add repo-specific instructions or constraints

**Cost:** Uses ChatGPT subscription (not API), so no additional charges.

## Commit Message Format

Use conventional commits for release-please:
- `feat:` → minor version bump
- `fix:` → patch version bump
- `feat!:` or `BREAKING CHANGE:` → major version bump
- `chore:`, `docs:` → no version bump
