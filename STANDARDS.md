# MCP Server Standards

This document defines the coding standards for all Very Good Plugins MCP servers.

## Quick Start

The fastest way to create a new MCP server that meets all standards:

```bash
# Create a TypeScript server
./scripts/create-server.sh typescript myservice "Brief description"

# Or a Python server
./scripts/create-server.sh python myservice "Brief description"
```

This scaffolds a complete project with all required files, configs, and workflows. Then just implement your tools in `src/index.ts` (TypeScript) or `src/mcp_myservice/server.py` (Python).

**Reference Implementation:** Use [mcp-freescout](https://github.com/verygoodplugins/mcp-freescout) as the canonical example for patterns not fully documented here.

---

## TypeScript Servers

### Requirements

- **Node.js:** ≥18.0.0
- **TypeScript:** ES2022 target, strict mode
- **MCP SDK:** @modelcontextprotocol/sdk ^1.25.1
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

### ESLint 9 Flat Config (eslint.config.mjs)

All TypeScript servers should use ESLint 9 with flat config:

```javascript
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      // MCP stdio servers must not write to stdout outside the protocol.
      'no-console': ['error', { allow: ['error', 'warn'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  }
);
```

**Required devDependencies:**
```json
{
  "@eslint/js": "^9.0.0",
  "typescript-eslint": "^8.0.0",
  "eslint-config-prettier": "^10.0.0"
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

// MCP stdio transport uses stdout for the protocol stream.
// Redirect stdout console methods to stderr to avoid corrupting the stream.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

// dotenv@17 can emit an informational runtime log mentioning `.env` to stdout.
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ quiet: true });

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
- **StdIO Logging:** never `print()` to stdout (reserved for MCP); use `logging` to stderr (e.g. `logging.basicConfig(stream=sys.stderr, level=logging.INFO)`)

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

## Support

For issues, questions, or suggestions:

- [Open an issue on GitHub](https://github.com/verygoodplugins/mcp-{name}/issues)
- [Contact Very Good Plugins](https://verygoodplugins.com/contact/?utm_source=github)

---

Built with 🧡 by [Very Good Plugins](https://verygoodplugins.com/?utm_source=github)
```

### README Style Guidelines

#### Footer Section (Required)

All READMEs must end with a Support section and VGP footer:

```markdown
## Support

For issues, questions, or suggestions:

- [Open an issue on GitHub](https://github.com/verygoodplugins/mcp-{name}/issues)
- [Contact Very Good Plugins](https://verygoodplugins.com/contact/?utm_source=github)

---

Built with 🧡 by [Very Good Plugins](https://verygoodplugins.com/?utm_source=github)
```

**Key requirements:**
- Orange heart emoji (🧡) - consistent VGP branding
- All links include `?utm_source=github` tracking
- Contact link goes to `/contact/` page (not homepage)
- Horizontal rule before the "Built with" line

#### Feature Emojis (Optional)

Feature lists may use emojis for visual appeal in the Features section:

| Emoji | Use Case |
|-------|----------|
| 🎫 | Tickets, items, records |
| 🔍 | Search, analysis, lookup |
| 💬 | Communication, messaging, notes |
| 📊 | Analytics, stats, reporting |
| 🔒 | Security, authentication |
| ⚡ | Performance, speed |
| 📥 | Downloads, imports |
| 👥 | Users, customers |
| 🛍️ | Products, purchases, commerce |
| 🏷️ | Tags, labels, discounts |

Example:
```markdown
## Features

- 📊 **Sales Analytics** - Revenue, transaction counts, date ranges
- 👥 **Customer Data** - Purchase history, lifetime value
- 🛍️ **Product Catalog** - Pricing tiers, licensing info
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

## Tool Schema Best Practices

### Handling External API Data

When tools interact with external APIs, response data may have optional or undefined fields. Avoid strict `outputSchema` definitions that cause validation errors when APIs return incomplete data.

**Problem:**
```typescript
// This causes "expected X, received undefined" errors
outputSchema: {
  type: 'object',
  properties: {
    id: { type: 'number' },
    email: { type: 'string' },  // API sometimes doesn't return this
    metadata: { type: 'object' }  // API sometimes returns null
  },
  required: ['id', 'email', 'metadata']
}
```

**Solutions:**

1. **Omit outputSchema entirely** for tools returning unpredictable external data:
```typescript
// Let the response pass through without validation
{
  name: 'get_external_data',
  description: 'Fetches data from external API',
  inputSchema: { /* validated inputs */ }
  // No outputSchema - response is unvalidated
}
```

2. **Use loose schemas** with optional fields:
```typescript
outputSchema: {
  type: 'object',
  properties: {
    id: { type: 'number' },
    email: { type: ['string', 'null'] },
    metadata: {}  // Accept any type
  },
  required: ['id']  // Only require guaranteed fields
}
```

3. **Validate and transform** in your handler before returning:
```typescript
const response = await api.getData();
return {
  id: response.id,
  email: response.email ?? null,
  metadata: response.metadata ?? {}
};
```

**When to use outputSchema:**
- Internal tools with predictable, controlled responses
- Tools that transform data into a known structure
- Simple tools returning primitive types

**When to omit outputSchema:**
- External API integrations with variable responses
- Tools that pass through third-party data structures
- Search/list tools returning different result shapes

---

## Security Requirements

1. **No hardcoded secrets** - Use environment variables
2. **Input validation** - Validate all tool arguments
3. **Error handling** - No stack traces in production
4. **Dependency auditing** - Regular `npm audit` / `pip-audit`
5. **OIDC publishing** - Use Trusted Publishing, no API tokens in secrets

---

## Desktop Extensions (Optional)

Desktop Extensions package MCP servers as `.mcpb` files for one-click installation in Claude Desktop. This is **optional** but recommended for servers targeting non-technical users.

**Reference:** [Anthropic Desktop Extensions Guide](https://www.anthropic.com/engineering/desktop-extensions)

### When to Use

- Servers targeting WordPress admins (EDD, WooCommerce integrations)
- Consumer-facing tools (finance, productivity)
- Any server where users may not be comfortable with JSON config
- Testing and demos

### When to Skip

- Developer-focused tools (code analysis, git integrations)
- Servers primarily used with Claude Code (CLI-based)
- Internal/enterprise tools with managed deployment

### Required Files

```
server-name/
├── manifest.json           # Extension metadata
├── assets/
│   ├── icon.png            # 128x128 primary icon (VGP orange #F97316)
│   └── screenshots/
│       └── main-usage.png  # Claude Desktop screenshots
├── .mcpbignore             # Exclude dev dependencies
└── ... (standard files)
```

### manifest.json Template (Full Branding)

```json
{
  "manifest_version": "0.2",
  "name": "io.github.verygoodplugins/mcp-{name}",
  "display_name": "{Display Name}",
  "version": "1.0.0",
  "description": "{Compelling benefit-focused description under 100 chars}",

  "long_description": "# {Display Name}\n\n{2-3 paragraphs with markdown}\n\n## Features\n\n- Feature 1\n- Feature 2\n\n## About Very Good Plugins\n\nBuilt by [Very Good Plugins](https://verygoodplugins.com/?utm_source=mcpb), creators of WP Fusion.\n\n---\n\n🧡 [VGP MCP Ecosystem](https://github.com/verygoodplugins)",

  "author": {
    "name": "Very Good Plugins",
    "email": "support@verygoodplugins.com",
    "url": "https://verygoodplugins.com/?utm_source=mcpb"
  },

  "icon": "assets/icon.png",

  "screenshots": [
    "assets/screenshots/main-usage.png"
  ],

  "server": {
    "type": "node",
    "entry_point": "dist/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/index.js"],
      "env": {
        "API_KEY": "${user_config.api_key}"
      }
    }
  },

  "user_config": {
    "api_key": {
      "type": "string",
      "title": "API Key",
      "description": "Your API key from the service dashboard",
      "sensitive": true,
      "required": true
    }
  },

  "tools": [
    { "name": "tool_name", "description": "Detailed description for discoverability" }
  ],

  "repository": {
    "type": "git",
    "url": "https://github.com/verygoodplugins/mcp-{name}"
  },

  "homepage": "https://verygoodplugins.com/mcp/?utm_source=mcpb",
  "documentation": "https://github.com/verygoodplugins/mcp-{name}#readme",
  "support": "https://github.com/verygoodplugins/mcp-{name}/issues",

  "privacy_policies": [
    "https://verygoodplugins.com/privacy-policy/?utm_source=mcpb"
  ],

  "license": "GPL-3.0",

  "keywords": [
    "mcp", "claude", "ai-tools", "wordpress",
    "{service}", "{service}", "automation", "verygoodplugins"
  ],

  "compatibility": {
    "claude_desktop": ">=1.0.0",
    "platforms": ["darwin", "win32", "linux"],
    "runtimes": { "node": ">=18.0.0" }
  }
}
```

### Key Branding Fields

| Field | Purpose |
|-------|---------|
| `long_description` | Markdown content for extension stores - include features, CTAs, VGP branding |
| `icon` / `icons` | VGP-branded icons (orange #F97316) for UI visibility |
| `screenshots` | Show Claude Desktop using the extension |
| `homepage` | verygoodplugins.com with UTM tracking (not GitHub) |
| `privacy_policies` | Enterprise-readiness signal |
| `keywords` | Include "mcp", "claude", "verygoodplugins" for discoverability |

### Configuration Fields

- `user_config` - Settings shown on install
- `server.mcp_config.env` - Maps user config to env vars: `${user_config.field_name}`
- `sensitive: true` - Stores in OS keychain
- `user_config` fields support: `type`, `title`, `description`, `required`, `sensitive`, `default`

### Bundle Size

Create `.mcpbignore` to exclude dev dependencies:

### Build Script

Add to package.json scripts:

```json
{
  "scripts": {
    "build:extension": "npm run build && npx @anthropic-ai/mcpb pack"
  }
}
```

### Distribution

1. **GitHub Releases** - Attach `.mcpb` file to releases (recommended)
2. **Direct download** - Host on project website
3. **README link** - Include download link in installation section
