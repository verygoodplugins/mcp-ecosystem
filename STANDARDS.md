# MCP Server Standards

This document defines the coding standards for all Very Good Plugins MCP servers.

## TypeScript Servers

### Requirements

- **Node.js:** ≥18.0.0
- **TypeScript:** ES2022 target, strict mode
- **MCP SDK:** @modelcontextprotocol/sdk ^0.5.0 (or ^1.x for new servers)
- **Package Manager:** npm
- **Module System:** ES modules (`"type": "module"`)

### Project Structure

```
server-name/
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── types.ts           # TypeScript interfaces
│   ├── *-client.ts        # API client wrapper
│   └── cli/               # CLI commands (optional)
├── dist/                  # Compiled output
├── tests/                 # Test files
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── release-please.yml
│   │   └── security.yml
│   └── dependabot.yml
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── .prettierrc
├── README.md
├── CLAUDE.md
├── CHANGELOG.md
├── LICENSE
└── server.json            # MCP Registry manifest
```

### package.json Requirements

```json
{
  "name": "@verygoodplugins/mcp-{name}",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "mcp-{name}": "dist/index.js"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "mcpName": "io.github.verygoodplugins/mcp-{name}",
  "scripts": {
    "build": "tsc && chmod +x dist/index.js",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/",
    "format": "prettier --write src/",
    "prepublishOnly": "npm run build && npm run test"
  },
  "publishConfig": {
    "access": "public"
  },
  "files": [
    "dist/",
    "README.md",
    "LICENSE"
  ]
}
```

### tsconfig.json Requirements

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Entry Point Pattern (src/index.ts)

```typescript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from 'dotenv';

config();

// Validate required environment variables
const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  console.error('Missing required API_KEY environment variable');
  process.exit(1);
}

const server = new Server(
  { name: 'mcp-{name}', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

const tools = [
  {
    name: 'tool_name',
    description: 'What this tool does',
    inputSchema: {
      type: 'object',
      properties: {
        param: { type: 'string', description: 'Parameter description' },
      },
      required: ['param'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  // Handle tool calls
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP server running on stdio');
}

main().catch(console.error);
```

---

## Python Servers

### Requirements

- **Python:** ≥3.11
- **Package Manager:** pip with pyproject.toml
- **Linting:** ruff
- **Testing:** pytest with asyncio support

### Project Structure

```
server-name/
├── src/
│   └── mcp_{name}/
│       ├── __init__.py
│       ├── server.py      # MCP server entry point
│       └── client.py      # API client wrapper
├── tests/
│   └── test_server.py
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── release.yml
│   │   └── security.yml
│   └── dependabot.yml
├── pyproject.toml
├── README.md
├── CLAUDE.md
├── CHANGELOG.md
├── LICENSE
└── server.json            # MCP Registry manifest
```

### pyproject.toml Requirements

```toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "mcp-{name}"
version = "1.0.0"
description = "MCP server for {service}"
readme = "README.md"
license = {text = "MIT"}
requires-python = ">=3.11"
dependencies = [
    "mcp>=0.9.0",
]

[project.scripts]
mcp-{name} = "mcp_{name}.server:main"

[project.urls]
Homepage = "https://github.com/verygoodplugins/mcp-{name}"
Repository = "https://github.com/verygoodplugins/mcp-{name}"

[tool.mcp]
name = "io.github.verygoodplugins/mcp-{name}"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W", "UP"]
```

---

## Required Files

### All Servers Must Have

| File | Purpose |
|------|---------|
| `README.md` | Documentation with installation, usage, configuration |
| `LICENSE` | MIT or GPL-3.0 (consistent with other VGP projects) |
| `CLAUDE.md` | AI assistant development guidance |
| `CHANGELOG.md` | Version history (auto-generated by release-please) |
| `server.json` | MCP Registry manifest |
| `.github/workflows/ci.yml` | Test and lint on PR |
| `.github/workflows/release*.yml` | Automated releases |
| `.github/workflows/security.yml` | Security scanning |
| `.github/dependabot.yml` | Dependency updates |

### README.md Template

```markdown
# mcp-{name}

Brief description of what this MCP server does.

## Installation

### npm (for Claude Desktop/Code)

\`\`\`bash
npx @verygoodplugins/mcp-{name}
\`\`\`

### Claude Desktop Configuration

\`\`\`json
{
  "mcpServers": {
    "mcp-{name}": {
      "command": "npx",
      "args": ["@verygoodplugins/mcp-{name}"],
      "env": {
        "API_KEY": "your_api_key"
      }
    }
  }
}
\`\`\`

## Tools

- `tool_name` - Description

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `API_KEY` | Yes | API key for the service |

## Development

\`\`\`bash
npm install
npm run dev
npm test
\`\`\`

## License

MIT

## Links

- [Very Good Plugins](https://verygoodplugins.com/?utm_source=github)
- [MCP Registry](https://modelcontextprotocol.info/)
```

---

## CI/CD Requirements

### GitHub Actions Workflows

1. **ci.yml** - Runs on every PR
   - Install dependencies
   - Run linter
   - Run tests
   - Build

2. **release-please.yml** (TypeScript) or **release.yml** (Python)
   - Triggered on push to main
   - Creates release PR with changelog
   - Publishes to npm/PyPI on release
   - Uses OIDC Trusted Publishing (no secrets)

3. **security.yml** - Weekly security scans
   - CodeQL analysis
   - Dependency vulnerability scanning

### Dependabot Configuration

```yaml
version: 2
updates:
  - package-ecosystem: "npm"  # or "pip"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      production-dependencies:
        patterns: ["*"]
```

---

## MCP Registry Requirements

### server.json (2025-12-11 schema)

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.verygoodplugins/mcp-{name}",
  "title": "MCP {Name}",
  "description": "Brief description under 100 characters",
  "version": "1.0.0",
  "websiteUrl": "https://verygoodplugins.com/?utm_source=mcp-registry",
  "repository": {
    "url": "https://github.com/verygoodplugins/mcp-{name}",
    "source": "github"
  },
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@verygoodplugins/mcp-{name}",
      "version": "1.0.0",
      "transport": {
        "type": "stdio"
      }
    }
  ],
  "tools": [
    {
      "name": "tool_name",
      "description": "What this tool does"
    }
  ]
}
```

**Key requirements:**
- Schema must be `2025-12-11` (not older versions)
- All field names are camelCase (`registryType`, not `registry_type`)
- `repository.source` must be `"github"` (not `type: "git"`)
- `transport` must be an object: `{ "type": "stdio" }`
- `description` must be under 100 characters
- `title` is recommended for display name
- `websiteUrl` at root level (replaces author.url)
- `tools` array documents available tools

### Package Linking

Add `mcpName` to package.json or `[tool.mcp]` to pyproject.toml to link the package to the registry entry.

---

## UTM Tracking

All external links in README and documentation must include UTM parameters:

```
https://verygoodplugins.com/?utm_source=github
https://wpfusion.com/?utm_source=github
https://automem.ai/?utm_source=github
```

When links appear in MCP Registry descriptions:
```
https://verygoodplugins.com/?utm_source=mcp-registry
```

---

## Testing Requirements

### Minimum Coverage

- **Initial:** ≥50% code coverage
- **Target:** ≥80% code coverage

### Test Categories

1. **Unit Tests** - API client methods, utilities
2. **Integration Tests** - Tool handlers with mocked responses
3. **Smoke Tests** - Server startup, tool listing

### TypeScript (Vitest)

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('API Client', () => {
  it('should fetch data', async () => {
    // Test implementation
  });
});
```

### Python (pytest)

```python
import pytest

@pytest.mark.asyncio
async def test_tool_handler():
    # Test implementation
    pass
```

---

## Security Requirements

1. **No hardcoded secrets** - Use environment variables
2. **Input validation** - Validate all tool arguments
3. **Error handling** - No stack traces in production
4. **Dependency auditing** - Regular `npm audit` / `pip-audit`
5. **OIDC publishing** - Use Trusted Publishing, no API tokens in secrets
