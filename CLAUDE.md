# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This is the **mcp-ecosystem** repository - shared infrastructure, templates, and standards for Very Good Plugins MCP servers. It provides:
- GitHub Actions workflow templates for TypeScript and Python MCP servers
- Audit and template-application scripts
- Publishing checklists for npm, PyPI, and MCP Registry
- Coding standards documentation

This repository does NOT contain MCP server implementations. Individual servers live in separate repos (mcp-automem, mcp-freescout, etc.).

## Common Commands

```bash
# Audit an MCP server against VGP standards
./scripts/audit-server.sh ../mcp-freescout

# Apply workflow templates to a server
./scripts/apply-templates.sh typescript ../mcp-freescout
./scripts/apply-templates.sh python ../mcp-ical

# Update README links with UTM tracking
./scripts/update-utm-links.sh ../mcp-freescout
```

## Architecture

```
mcp-ecosystem/
├── templates/
│   ├── typescript/.github/     # CI, release-please, security workflows
│   └── python/.github/         # CI, release, security workflows
├── scripts/
│   ├── audit-server.sh         # Checks required files, CI/CD, security
│   ├── apply-templates.sh      # Copies workflows to target server
│   └── update-utm-links.sh     # Adds ?utm_source=github to links
├── server-inventory.json       # Machine-readable list of all VGP MCP servers
├── STANDARDS.md                # TypeScript/Python coding standards
└── PUBLISHING.md               # npm/PyPI/MCP Registry publishing checklist
```

## Key Standards (from STANDARDS.md)

**TypeScript servers:**
- Node.js ≥18, ES2022, strict mode
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
- README.md, LICENSE, CHANGELOG.md, CLAUDE.md
- server.json (MCP Registry manifest)
- .github/workflows/ci.yml, security.yml, release*.yml
- .github/dependabot.yml

## Server Inventory

The `server-inventory.json` tracks all VGP MCP servers with their publication status, CI/CD state, and test coverage. Update this file when adding new servers or changing their status.

## Publishing Workflow

1. Apply templates: `./scripts/apply-templates.sh typescript ../mcp-{name}`
2. Add `mcpName` to package.json
3. Create `server.json` for MCP Registry
4. Publish to npm first (for new packages)
5. Configure Trusted Publishing on npm
6. Submit to MCP Registry: `npx @anthropic-ai/mcp publish server.json`

## Commit Message Format

Use conventional commits for release-please:
- `feat:` → minor version bump
- `fix:` → patch version bump
- `feat!:` or `BREAKING CHANGE:` → major version bump
- `chore:`, `docs:` → no version bump
