# MCP Ecosystem

Shared infrastructure, templates, and standards for Very Good Plugins MCP servers.

## Our MCP Servers

| Server                                                            | Description                           | npm/PyPI                                                                                       | MCP Registry |
| ----------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------ |
| [mcp-automem](https://github.com/verygoodplugins/mcp-automem)     | Graph-vector memory for AI assistants | [@verygoodplugins/mcp-automem](https://www.npmjs.com/package/@verygoodplugins/mcp-automem)     | ✅           |
| [mcp-edd](https://github.com/verygoodplugins/mcp-edd)             | Easy Digital Downloads                | [@verygoodplugins/mcp-edd](https://www.npmjs.com/package/@verygoodplugins/mcp-edd)             | ✅           |
| [mcp-evernote](https://github.com/verygoodplugins/mcp-evernote)   | Evernote note management              | [@verygoodplugins/mcp-evernote](https://www.npmjs.com/package/@verygoodplugins/mcp-evernote)   | ✅           |
| [mcp-freescout](https://github.com/verygoodplugins/mcp-freescout) | FreeScout helpdesk integration        | [@verygoodplugins/mcp-freescout](https://www.npmjs.com/package/@verygoodplugins/mcp-freescout) | ✅           |
| [mcp-local-wp](https://github.com/verygoodplugins/mcp-local-wp)   | WordPress via Local by Flywheel       | [@verygoodplugins/mcp-local-wp](https://www.npmjs.com/package/@verygoodplugins/mcp-local-wp)   | ✅           |
| [mcp-pirsch](https://github.com/verygoodplugins/mcp-pirsch)       | Pirsch Analytics integration          | [@verygoodplugins/mcp-pirsch](https://www.npmjs.com/package/@verygoodplugins/mcp-pirsch)       | ✅           |
| [mcp-toggl](https://github.com/verygoodplugins/mcp-toggl)         | Toggl Track time tracking             | [@verygoodplugins/mcp-toggl](https://www.npmjs.com/package/@verygoodplugins/mcp-toggl)         | ✅           |
| mcp-ical                                                          | macOS Calendar integration            | PyPI                                                                                           | ✅           |
| telegram-mcp                                                      | Telegram messaging                    | PyPI                                                                                           | ✅           |
| whatsapp-mcp                                                      | WhatsApp messaging                    | GitHub Release                                                                                 | ✅           |
| streamdeck-mcp                                                    | Elgato Stream Deck control            | PyPI                                                                                           | ✅           |

## Repository Structure

```text
mcp-ecosystem/
├── README.md                    # This file
├── STANDARDS.md                 # Coding standards for all servers
├── PUBLISHING.md                # Publishing checklist
├── config/
│   └── ecosystem-policy.json    # Machine-readable repo profiles and policy
├── templates/
│   ├── typescript/              # Templates for TypeScript MCP servers
│   │   └── .github/workflows/
│   │       ├── ci.yml
│   │       ├── dependabot-auto-merge.yml
│   │       ├── release-please.yml
│   │       └── security.yml
│   └── python/                  # Templates for Python MCP servers
│       └── .github/workflows/
│           ├── ci.yml
│           ├── dependabot-auto-merge.yml
│           ├── release.yml
│           └── security.yml
├── scripts/
│   ├── audit-server.sh          # Audit a server against standards
│   ├── apply-templates.sh       # Copy templates to a server
│   ├── configure-github-defaults.sh # Apply repo-level GitHub defaults
│   ├── render-managed-files.mjs # Generate profile-aware managed workflows/config
│   ├── validate-sync.mjs        # Preflight generated diffs before opening PRs
│   ├── register-mcp.sh          # Submit to MCP Registry
│   └── update-utm-links.sh      # Update README links with UTM
└── server-inventory.json        # Machine-readable inventory
```

## Quick Start

### Audit an existing server

```bash
./scripts/audit-server.sh ../mcp-freescout
```

### Apply templates to a server

```bash
./scripts/apply-templates.sh typescript ../mcp-freescout
```

### Preview downstream template drift

```bash
./scripts/propagate-templates.sh --server mcp-pirsch --dry-run
```

### Validate a generated sync before opening a PR

```bash
./scripts/render-managed-files.mjs whatsapp-mcp ../whatsapp-mcp
./scripts/sync-template-baseline.mjs whatsapp-mcp ../whatsapp-mcp
./scripts/validate-sync.mjs whatsapp-mcp ../whatsapp-mcp
```

### Register a server in MCP Registry

```bash
./scripts/register-mcp.sh ../mcp-freescout
```

## Standards

See [STANDARDS.md](./STANDARDS.md) for complete coding standards.

Key requirements:

- **TypeScript:** Node.js ≥18, ES2022, strict mode, Vitest, release-please
- **Python:** Python ≥3.11, pyproject.toml, pytest, ruff
- **All:** CI/CD, security scanning, MCP Registry, UTM tracking

## Source Of Truth

`mcp-ecosystem` is the source of truth for shared MCP server workflows, config, and baseline dependency versions.

- Update templates and shared baselines here first.
- Merge the source-of-truth change to `main`.
- `server-inventory.json` now carries repo capabilities such as `packagePath`, `ciProfile`, `releaseProfile`, `securityProfile`, `templateTier`, and `propagate`.
- `config/ecosystem-policy.json` is the machine-readable source for shared CI/release/security policy and repo defaults.
- `.github/workflows/propagate-templates.yml` opens or updates `chore/template-sync` PRs in downstream repos from `server-inventory.json`.
- `scripts/render-managed-files.mjs` generates profile-aware managed workflows/config instead of force-copying one workflow shape into every repo.
- `scripts/sync-template-baseline.mjs` updates managed dependency baselines with parsed JSON/TOML data and reports when lockfiles need regeneration.
- `scripts/validate-sync.mjs` blocks PR creation when the generated diff is incompatible with the repo profile.
- Org rulesets are the canonical branch-protection layer for MCP repos; repo-level
  GitHub booleans like `allow_auto_merge` are applied separately with
  `scripts/configure-github-defaults.sh`.
- See [STANDARDS.md](./STANDARDS.md#branch-protection-and-auto-merge) for the
  current org rulesets, repo-level defaults, and rollout policy.

The propagation workflow requires an org/repo secret named `VGP_TEMPLATE_SYNC_TOKEN` with access to the downstream repos and workflow files.

## Publishing

See [PUBLISHING.md](./PUBLISHING.md) for the complete publishing checklist.

## Links

- [MCP Specification](https://modelcontextprotocol.io/)
- [MCP Registry](https://modelcontextprotocol.info/tools/registry/)
- [Very Good Plugins](https://verygoodplugins.com/?utm_source=github)
- [WP Fusion](https://wpfusion.com/?utm_source=github)
- [AutoMem](https://automem.ai/?utm_source=github)

## Follow

- X: [@jjack_arturo](https://x.com/jjack_arturo)
- GitHub: [@verygoodplugins](https://github.com/verygoodplugins)
