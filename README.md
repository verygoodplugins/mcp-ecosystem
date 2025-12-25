# MCP Ecosystem

Shared infrastructure, templates, and standards for Very Good Plugins MCP servers.

## Our MCP Servers

| Server | Description | npm/PyPI | MCP Registry |
|--------|-------------|----------|--------------|
| [mcp-automem](https://github.com/verygoodplugins/mcp-automem) | Graph-vector memory for AI assistants | [@verygoodplugins/mcp-automem](https://www.npmjs.com/package/@verygoodplugins/mcp-automem) | ✅ |
| [mcp-evernote](https://github.com/verygoodplugins/mcp-evernote) | Evernote note management | [@verygoodplugins/mcp-evernote](https://www.npmjs.com/package/@verygoodplugins/mcp-evernote) | ✅ |
| [mcp-freescout](https://github.com/verygoodplugins/mcp-freescout) | FreeScout helpdesk integration | [@verygoodplugins/mcp-freescout](https://www.npmjs.com/package/@verygoodplugins/mcp-freescout) | ✅ |
| [mcp-local-wp](https://github.com/verygoodplugins/mcp-local-wp) | WordPress via Local by Flywheel | [@verygoodplugins/mcp-local-wp](https://www.npmjs.com/package/@verygoodplugins/mcp-local-wp) | ✅ |
| [mcp-pirsch](https://github.com/verygoodplugins/mcp-pirsch) | Pirsch Analytics integration | [@verygoodplugins/mcp-pirsch](https://www.npmjs.com/package/@verygoodplugins/mcp-pirsch) | ✅ |
| [mcp-toggl](https://github.com/verygoodplugins/mcp-toggl) | Toggl Track time tracking | [@verygoodplugins/mcp-toggl](https://www.npmjs.com/package/@verygoodplugins/mcp-toggl) | ✅ |
| mcp-ical | macOS Calendar integration | PyPI | ✅ |
| telegram-mcp | Telegram messaging | PyPI | ✅ |
| whatsapp-mcp | WhatsApp messaging | PyPI | ✅ |
| streamdeck-mcp | Elgato Stream Deck control | PyPI | ✅ |

## Repository Structure

```
mcp-ecosystem/
├── README.md                    # This file
├── STANDARDS.md                 # Coding standards for all servers
├── PUBLISHING.md                # Publishing checklist
├── templates/
│   ├── typescript/              # Templates for TypeScript MCP servers
│   │   └── .github/workflows/
│   │       ├── ci.yml
│   │       ├── release-please.yml
│   │       └── security.yml
│   └── python/                  # Templates for Python MCP servers
│       └── .github/workflows/
│           ├── ci.yml
│           ├── release.yml
│           └── security.yml
├── scripts/
│   ├── audit-server.sh          # Audit a server against standards
│   ├── apply-templates.sh       # Copy templates to a server
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
