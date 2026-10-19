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

- **Node.js:** ≥24.0.0
- **TypeScript:** ES2022 target, strict mode
- **MCP SDK:** `@modelcontextprotocol/server` ^2.0.0 with Zod schemas
- **Linting:** ESLint 10 flat config
- **Testing:** Vitest 4 (including `npm run test:coverage` when coverage is needed)
- **Package Manager:** npm
- **Module System:** ES modules (`"type": "module"`)

### Project Structure

```
server-name/
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── types.ts           # Optional TypeScript interfaces
│   ├── *-client.ts        # Optional API client wrapper
│   └── cli/               # CLI commands (optional)
├── dist/                  # Compiled output
├── tests/                 # Test files
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── dependabot-auto-merge.yml
│   │   ├── pr-title.yml
│   │   ├── release-please.yml
│   │   └── security.yml
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   ├── feature_request.yml
│   │   └── config.yml
│   ├── CODEOWNERS
│   ├── SECURITY.md
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── dependabot.yml
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── .prettierrc
├── README.md
├── AGENTS.md
├── CHANGELOG.md
├── LICENSE
└── server.json            # MCP Registry manifest
```

### package.json Requirements

```json
{
  "name": "@verygoodplugins/mcp-{name}",
  "version": "1.0.0",
  "description": "{description}",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "mcp-{name}": "dist/index.js"
  },
  "engines": {
    "node": ">=24.0.0"
  },
  "mcpName": "io.github.verygoodplugins/mcp-{name}",
  "scripts": {
    "build": "tsc && chmod +x dist/index.js",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/",
    "format": "prettier --write src/ tests/",
    "prepublishOnly": "npm run build && npm run test"
  },
  "publishConfig": {
    "access": "public"
  },
  "files": ["dist/", "README.md", "LICENSE", "CHANGELOG.md"],
  "keywords": ["mcp", "model-context-protocol", "ai", "claude", "{name}"],
  "author": "Very Good Plugins <support@verygoodplugins.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/verygoodplugins/mcp-{name}.git"
  },
  "bugs": {
    "url": "https://github.com/verygoodplugins/mcp-{name}/issues"
  },
  "homepage": "https://github.com/verygoodplugins/mcp-{name}#readme",
  "dependencies": {
    "@modelcontextprotocol/server": "^2.0.0",
    "dotenv": "^17.2.3",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^24.19.2",
    "@vitest/coverage-v8": "^4.1.10",
    "eslint": "^10.8.1",
    "eslint-config-prettier": "^10.1.8",
    "prettier": "^3.5.3",
    "tsx": "^4.19.4",
    "typescript": "^6.0.3",
    "typescript-eslint": "^8.67.0",
    "vitest": "^4.1.10"
  }
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

### ESLint 10 Flat Config (eslint.config.mjs)

All TypeScript servers should use ESLint 10 with flat config:

```javascript
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["src/**/*.ts"],
    rules: {
      // MCP stdio servers must not write to stdout outside the protocol.
      "no-console": ["error", { allow: ["error", "warn"] }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "coverage/"],
  },
);
```

**Required devDependencies:**

```json
{
  "@eslint/js": "^10.0.1",
  "eslint": "^10.8.1",
  "typescript-eslint": "^8.67.0",
  "eslint-config-prettier": "^10.1.8"
}
```

### Entry Point Pattern (src/index.ts)

```typescript
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { config } from 'dotenv';
import { z } from 'zod';

// stdout is reserved for the MCP protocol. dotenv@17 is silent when quiet.
process.env.DOTENV_CONFIG_QUIET = 'true';
config({ quiet: true });

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'mcp-{name}',
    version: '1.0.0',
  });

  server.registerTool(
    'example_tool',
    {
      title: 'Example read-only tool',
      description: 'Example tool - replace with your actual tools',
      inputSchema: z.object({
        query: z.string().min(1).describe('The query to process'),
      }),
      outputSchema: z.object({ result: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ query }) => {
      try {
        // Validate credentials lazily in the client or tool handler so
        // tools/list remains usable before a host supplies secrets.
        const output = { result: `Processed query: ${query}` };
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : 'Tool request failed.' }],
          isError: true,
        };
      }
    },
  );

  return server;
}

export function startServer(): void {
  serveStdio(createServer, {
    onerror: error => {
      console.error(`mcp-{name} stdio error: ${error.message}`);
    },
  });
  console.error('mcp-{name} server running on stdio');
}

startServer();
```

The v2 starter uses `McpServer.registerTool` with Zod input schemas and the
`serveStdio` entrypoint. Do not mix this model with legacy `Server`, request
schema imports, or `setRequestHandler` calls from `@modelcontextprotocol/sdk`.

Validate external credentials only in the client or tool handler. Startup must
still be able to serve `tools/list`, so hosts can inspect configuration without
secrets. For discovery tools, project upstream records into an intentional safe
summary instead of returning account, member, token, or configuration metadata.

---

## Python Servers

### Requirements

- **Python:** ≥3.11
- **Package Manager:** pip with pyproject.toml
- **MCP SDK:** `mcp>=1.0.0`
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
│       └── client.py      # Optional API client wrapper
├── tests/
│   └── test_server.py
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   ├── dependabot-auto-merge.yml
│   │   ├── pr-title.yml
│   │   ├── release.yml
│   │   └── security.yml
│   └── dependabot.yml
├── pyproject.toml
├── README.md
├── AGENTS.md
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
description = "{description}"
readme = "README.md"
license = {text = "MIT"}
requires-python = ">=3.11"
authors = [
    {name = "Very Good Plugins", email = "support@verygoodplugins.com"}
]
keywords = ["mcp", "model-context-protocol", "ai", "claude", "{name}"]
classifiers = [
    "Development Status :: 4 - Beta",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.11",
    "Programming Language :: Python :: 3.12",
]
dependencies = [
    "mcp>=1.0.0",
    "httpx>=0.27.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "pytest-cov>=4.1.0",
    "ruff>=0.1.0",
]

[project.scripts]
mcp-{name} = "mcp_{name_underscore}.server:main"

[project.urls]
Homepage = "https://github.com/verygoodplugins/mcp-{name}"
Repository = "https://github.com/verygoodplugins/mcp-{name}"
Issues = "https://github.com/verygoodplugins/mcp-{name}/issues"

[tool.mcp]
name = "io.github.verygoodplugins/mcp-{name}"

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W", "UP"]

[tool.coverage.run]
source = ["src/mcp_{name_underscore}"]
branch = true

[tool.coverage.report]
exclude_lines = [
    "pragma: no cover",
    "if __name__ == .__main__.:",
]
```

---

## Required Files

### All Servers Must Have

| File                                          | Purpose                                                          |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `README.md`                                   | Documentation with installation, usage, configuration            |
| `LICENSE`                                     | MIT or GPL-3.0 (consistent with other VGP projects)              |
| `AGENTS.md`                                   | Host-neutral contributor and coding-agent guidance               |
| `CLAUDE.md`                                   | Optional compatibility entry point linking to `AGENTS.md`        |
| `CHANGELOG.md`                                | Version history; Release Please updates it for TypeScript releases |
| `server.json`                                 | MCP Registry manifest                                            |
| `.github/workflows/ci.yml`                    | Test and lint on PR                                              |
| `.github/workflows/dependabot-auto-merge.yml` | Approve + enable auto-merge for safe Dependabot PRs              |
| `.github/workflows/pr-title.yml`              | Enforce conventional PR titles (required for squash-merge repos) |
| `.github/workflows/release*.yml`              | Automated releases                                               |
| `.github/workflows/security.yml`              | Security scanning                                                |
| `.github/dependabot.yml`                      | Dependency updates                                               |
| `.github/CODEOWNERS`                          | Default reviewer routing                                         |
| `.github/SECURITY.md`                         | Vulnerability reporting policy (Private Vulnerability Reporting) |
| `.github/PULL_REQUEST_TEMPLATE.md`            | Conventional PR scaffold                                         |
| `.github/ISSUE_TEMPLATE/bug_report.yml`       | Forms-style bug template                                         |
| `.github/ISSUE_TEMPLATE/feature_request.yml`  | Forms-style feature template                                     |
| `.github/ISSUE_TEMPLATE/config.yml`           | Disables blank issues; routes security reports to Advisories     |

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

| Variable  | Required | Description             |
| --------- | -------- | ----------------------- |
| `API_KEY` | Yes      | API key for the service |

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

| Emoji | Use Case                        |
| ----- | ------------------------------- |
| 🎫    | Tickets, items, records         |
| 🔍    | Search, analysis, lookup        |
| 💬    | Communication, messaging, notes |
| 📊    | Analytics, stats, reporting     |
| 🔒    | Security, authentication        |
| ⚡    | Performance, speed              |
| 📥    | Downloads, imports              |
| 👥    | Users, customers                |
| 🛍️    | Products, purchases, commerce   |
| 🏷️    | Tags, labels, discounts         |

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
   - Explicitly subscribes to `merge_group.checks_requested` so required checks run inside GitHub merge queue

2. **release-please.yml** (TypeScript)
   - Triggered on push to main
   - Creates release PR with changelog
   - On the release tag, publishes to npm with OIDC Trusted Publishing (no npm secret)
   - Also publishes a GitHub Packages (`npm.pkg.github.com`) mirror via `GITHUB_TOKEN`; this job is `continue-on-error: true`, so npmjs success defines a successful release. See [PUBLISHING.md](./PUBLISHING.md#github-packages-mirror-typescript) for consumer-side caveats.
   - After npm succeeds, publishes the release to the MCP Registry with GitHub OIDC; the `mcp-registry-publish` job depends on `npm-publish`.
   - **Must use `RELEASE_PLEASE_TOKEN`** (org-level PAT) so the Release PR triggers CI workflows. PRs created by the default `GITHUB_TOKEN` don't trigger other workflows (GitHub security feature), which blocks required status checks.
   - Uses manifest mode (`release-please-config.json` + `.release-please-manifest.json`)

3. **release.yml** (Python)
   - Triggered only when a `v*` tag is pushed
   - Builds the package, publishes it to PyPI with OIDC Trusted Publishing, and creates a GitHub Release with generated notes
   - Does not use Release Please or a release manifest; update the Python version and changelog before creating the tag

4. **pr-title.yml** - Enforces conventional PR titles on PRs targeting `main`
   - Required because squash merges use the PR title as the commit title on `main`
   - Required for TypeScript repositories because Release Please parses merged commit titles to build changelogs and version bumps
   - Should be required via branch protection or an organization ruleset

5. **security.yml** - Weekly security scans
   - CodeQL analysis
   - Dependency vulnerability scanning

6. **dependabot-auto-merge.yml** - Approves safe Dependabot PRs and enables GitHub auto-merge
   - Runs on `pull_request_target` plus a `workflow_run` retry pass, with a caller-side `github.event.pull_request.user.login == 'dependabot[bot]'` guard
   - Gate on the PR **author**, never `github.actor` — but only once the reusable workflow carries the commit-provenance check (see below). The actor is whoever triggered the run, so an actor guard skips the job when a maintainer reopens or pushes to a Dependabot PR, which stops the head being re-evaluated at all
   - Must forward `GH_TOKEN`, `AUTOMERGE_APP_CLIENT_ID` and `AUTOMERGE_APP_PRIVATE_KEY` explicitly. A called workflow only receives the secrets its caller forwards, so mapping `GH_TOKEN` alone withholds the App-token secrets and the job runs degraded. Not `secrets: inherit` — that hands every caller-accessible secret to a workflow tracked at a mutable `@main`
   - Must not narrow `permissions:` below `contents: write` + `pull-requests: write`. A callee cannot hold a permission its caller lacks, and exceeding it is a **startup failure** before any step runs
   - Uses CI + org rulesets as the safety gate
   - Thin stub that delegates all logic to the reusable workflow at [`verygoodplugins/.github`](https://github.com/verygoodplugins/.github/blob/main/.github/workflows/dependabot-auto-merge.yml)
   - Auto-merges `semver-patch` and `semver-minor` updates after required checks pass
   - Major updates always require manual review

### Dependabot Configuration

```yaml
version: 2
updates:
  - package-ecosystem: "npm" # or "pip"
    directory: "/"
    schedule:
      interval: "weekly"
    ignore:
      - dependency-name: "@types/node"
        update-types:
          - "version-update:semver-major"
    groups:
      # npm / TypeScript
      security-updates:
        applies-to: security-updates
        patterns:
          - "*"
      production-minor-patch:
        applies-to: version-updates
        dependency-type: "production"
        update-types:
          - "minor"
          - "patch"
      eslint-minor-patch:
        applies-to: version-updates
        dependency-type: "development"
        patterns:
          - "@eslint/*"
          - "eslint"
          - "eslint-*"
          - "typescript-eslint"
        update-types:
          - "minor"
          - "patch"
      typescript-minor-patch:
        applies-to: version-updates
        dependency-type: "development"
        patterns:
          - "@types/*"
          - "tsx"
          - "typescript"
        update-types:
          - "minor"
          - "patch"
      vitest-updates:
        applies-to: version-updates
        dependency-type: "development"
        patterns:
          - "@vitest/*"
          - "vitest"
        update-types:
          - "major"
          - "minor"
          - "patch"
      test-tooling-minor-patch:
        applies-to: version-updates
        dependency-type: "development"
        patterns:
          - "@jest/*"
          - "jest"
          - "jest-*"
          - "ts-jest"
        update-types:
          - "minor"
          - "patch"
      development-minor-patch:
        applies-to: version-updates
        dependency-type: "development"
        exclude-patterns:
          - "@eslint/*"
          - "@jest/*"
          - "@types/*"
          - "@vitest/*"
          - "eslint"
          - "eslint-*"
          - "jest"
          - "jest-*"
          - "ts-jest"
          - "tsx"
          - "typescript"
          - "typescript-eslint"
          - "vitest"
        update-types:
          - "minor"
          - "patch"
      # pip / Python
      dev-dependencies:
        dependency-type: "development"
```

Keep `@types/node` on the declared runtime/CI major. Dependabot ignores major
updates for that dependency; change its major deliberately when changing the
runtime floor. Minor and patch declaration updates remain eligible.

For npm version updates, groups are scoped to `minor` and `patch`, except
`vitest-updates`: it groups `vitest` with `@vitest/*` across major, minor and
patch releases because the runner and coverage provider require matching
versions. Grouped Vitest major upgrades still require manual review and passing
CI; grouping does not authorize auto-merge. Keep other production and dev-tooling
majors ungrouped for manual review. Only the `security-updates` group may use a
wildcard pattern that matches all packages.

### Branch Protection And Auto-Merge

Branch protection and required CI checks are managed centrally with GitHub
organization rulesets where GitHub supports org-level enforcement. Merge queue
is repository-level only, so enable it per repository after the CI workflow explicitly
subscribes to `merge_group.checks_requested`. Repo-level booleans and workflow files stay in each repo
because GitHub does not provide org defaults for them.

`server-inventory.json` is the control plane for repo-specific capability data.
Every managed repo should declare:

- `packageLayout` and `packagePath`
- `ciProfile`
- `releaseProfile`
- `securityProfile`
- `templateTier`
- `propagate`
- optional `allowOverrides`, `allowedPackageFiles`, `coverageTargets`, `dependabot`, or `codeqlConfigPath`

`allowedPackageFiles` extends the secure package-file default (`dist/**`,
`README.md`, `LICENSE`, and `CHANGELOG.md`); it never replaces that default.
Each inventory value must exactly match an entry in `package.json.files`.
Wildcard characters are compared literally here rather than expanded into a
broader policy exception.

For external-service checks, choose the explicit integration profile rather
than adding a conditional step to the stable test job. For example,
`mcp-freescout` uses `ts-vitest-integration-nonblocking`; it maps only
`FREESCOUT_URL` and `FREESCOUT_API_KEY`, runs after `Test` on pushes to `main`,
and cannot make the required check fail. Its release profile is
`release-please-manifest`.

`config/ecosystem-policy.json` is the machine-readable policy source that
defines the supported profile IDs and their required workflows, scripts, release
artifacts, and repo defaults. `scripts/render-managed-files.mjs`,
`scripts/validate-sync.mjs`, and `scripts/audit-server.sh` all consume this data
so policy stays consistent across generation and auditing.

**Current org rulesets:**

- `Protect MCP Main Branches` (`11708193`): covers MCP default branches, blocks
  force-push/delete, requires PRs, linear history, resolved conversations, and
  `squash` merges only. Bypass: `RepositoryRole:5` (admin) always.
- `MCP Python/Go CI` (`13414905`): requires `Python Lint`, `Go Lint`,
  `Go Build`, and `Python Tests` for `whatsapp-mcp` and `robinhood-mcp`.
- `MCP TypeScript CI` (`13414915`): still requires the legacy `test` check for
  `mcp-*` TypeScript repos (excluding `mcp-ecosystem`) until propagated
  templates converge on the new `TypeScript CI` check name.
- `MCP WhatsApp Hybrid Checks` (`15448591`): requires `Version Consistency`,
  `Go Vulnerability Check`, `CodeQL Analysis (Go)`, and
  `CodeQL Analysis (Python)` for `whatsapp-mcp`.
- `Copilot Auto Review` (`14736230`): triggers Copilot review on PR open/ready
  across the org, excluding automation branches. `review_on_push` is **off** —
  Copilot reviews once on open, not on every commit push.
- `Protect Release Tags` (`11708252`): blocks delete/update on `refs/tags/v*`
  for MCP repos.

Audited MCP repos no longer carry duplicate repo-local rulesets or classic
branch protection on `main`; org rulesets are now the canonical protection
layer.

**Required repo-level defaults:**

- `allow_auto_merge=true`
- `delete_branch_on_merge=true`
- `allow_squash_merge=true`
- merge queue enabled on `main` after required CI checks are configured
- vulnerability alerts enabled
- automated security fixes enabled
- `.github/workflows/dependabot-auto-merge.yml`
- `AUTOMERGE_APP_CLIENT_ID` and `AUTOMERGE_APP_PRIVATE_KEY` reachable as **both**
  Actions and Dependabot secrets (set once at org level), and the auto-merge
  GitHub App installed on the repo — see **Auto-merge policy** below

Apply those per-repo settings with
`./scripts/configure-github-defaults.sh <repo-slug|repo-name|path>`.
The script refuses to enable a queue until the target CI workflow includes that explicit
`merge_group` subscription.

**Auto-merge policy:**

The canonical logic lives in [`verygoodplugins/.github/.github/workflows/dependabot-auto-merge.yml`](https://github.com/verygoodplugins/.github/blob/main/.github/workflows/dependabot-auto-merge.yml). Each repo carries only a small guarded stub calling it. Edit the reusable workflow to change policy org-wide.

| Update type                       | Policy    |
| --------------------------------- | --------- |
| `semver-patch` — any ecosystem    | ✅ auto   |
| `semver-minor` — any ecosystem    | ✅ auto   |
| Security update — any non-major   | ✅ auto   |
| Major — any ecosystem             | ❌ manual |
| No reported update type           | ❌ manual |

Patch and minor are an **allowlist**, not "anything but major". A bump whose
update type Dependabot does not report — metadata unavailable, or a non-semver
ecosystem — is left for a human rather than merged by default. The workflow logs
the reason it declined, so the symptom is visible rather than silent.

The reusable workflow also applies `dependencies` plus either `automerge` or
`needs-human-review` so Dependabot queues stay auditable at a glance. Neither is a
manual hold: to hold a single PR by hand, close it or use `@dependabot ignore`. The
`automerge` label is applied for patch and minor only, so that it means the same
thing as the arm gate — but it is **not** what the `workflow_run` retry pass reads.
That pass reads a head-bound `dependabot-auto-merge/eligible` commit status; see the
safety properties below for why a label cannot do that job.

**The workflow merges with a GitHub App token, not `GITHUB_TOKEN`.** This is a
hard requirement, not a preference. GitHub does not start new workflow runs from
events caused by `GITHUB_TOKEN`, and that extends to the merge an auto-merge it
armed performs. Measured on `mcp-automem`, where the swap has shipped and run:

| Merge | Token | `event=push` runs |
| --- | --- | --- |
| 5775c95, 07db972, 9ed9084 | `GITHUB_TOKEN` auto-merge | **0** |
| 72bc31e, 7b45e959 | App token | **3** |
| d2a2660, 06f6fb1 | human | **4** |

So auto-merged bumps silently skipped the release-PR update, the push-to-main CI
run that is the only thing testing bumps *in combination*, and the push-triggered
security scan — not the weekly one, which runs off an independent `schedule` trigger
and was never affected. `7b45e959` is the end-to-end proof: an auto-merge armed by the App
and merged by `vgp-dependabot-auto-merge[bot]`, where identical `GITHUB_TOKEN`
auto-merges had produced nothing.

**Compare against 0, not against a count.** The number of push-triggered workflows
is per-repo, and varies within a repo. The 4 above is not a baseline: `mcp-automem`
has three workflows on `push: branches: [main]` — `ci.yml`, `release-please.yml`,
`security.yml` — and those two human merges each also cut a release, which pulls in
`docs-dispatch.yml` as an inherited `event=push` run through a gated
`workflow_call` from release-please. An ordinary bump there shows **3**, and 3 is
not a failure.

```bash
gh api "repos/OWNER/REPO/actions/runs?head_sha=SHA&event=push" --jq '.total_count'
```

Filter on `event=push`. A bare total is misleading: a Dependabot merge commit
reports its own `event=dynamic` update runs attached to the default branch.

Setup, once at org level:

- A GitHub App installed across the org, granted **Contents RW, Pull requests RW,
  Issues RW, Workflows RW, Merge queues RW, Commit statuses RW, Metadata R**. `actions/create-github-app-token` scopes
  the token it mints to its `permission-*` inputs, and requesting a permission the
  installation lacks fails the mint outright — so the App grants must be at least
  as wide as the workflow asks for. Workflows RW is required by any repo whose
  `dependabot.yml` includes the `github-actions` ecosystem; without it a bump
  touching `.github/workflows/` cannot be merged. Merge queues RW is for the
  enqueue path: no repo has a queue enabled today, but granting it up front means
  turning one on is a ruleset change rather than a token change, and without it the
  enqueue fails outright rather than degrading, because by then the mint has already
  succeeded.
- `AUTOMERGE_APP_CLIENT_ID` and `AUTOMERGE_APP_PRIVATE_KEY` as **Actions secrets
  and Dependabot secrets**, in both, always. Which store a Dependabot-triggered
  `pull_request_target` run actually reads is not worth resolving: GitHub's docs list
  the restriction (Dependabot secrets populated, Actions secrets unavailable) for
  `pull_request`, `pull_request_review`, `pull_request_review_comment`, `push`,
  `create`, `deployment` and `deployment_status`, and apply it to
  `pull_request_target` only when *the base ref of the pull request was created by
  Dependabot* — which a bump opened against `main` is not. Empirically, mcp-automem
  run `39327021484` (a Dependabot-triggered `pull_request_target`) minted the token
  successfully, but the secrets were in both stores, so it does not identify which
  one was read. Setting both costs nothing and removes the question; it is also
  required outright if a repo ever adds a `pull_request`-triggered path.
- Every stub forwarding all three secrets explicitly, or the App secrets never reach
  the callee:

  ```yaml
      secrets:
        GH_TOKEN: ${{ secrets.GH_TOKEN }}
        AUTOMERGE_APP_CLIENT_ID: ${{ secrets.AUTOMERGE_APP_CLIENT_ID }}
        AUTOMERGE_APP_PRIVATE_KEY: ${{ secrets.AUTOMERGE_APP_PRIVATE_KEY }}
  ```

  Not `secrets: inherit`. It would solve the forwarding problem, but it passes *every*
  caller-accessible secret — npm and registry tokens, deployment credentials — to a
  reusable workflow the stubs track at `@main`, which can change without review in the
  consuming repo. A secret a repo has not set forwards as empty, which is the intended
  degrade path rather than an error.

A stub that pins the reusable workflow to an immutable SHA rather than `@main`
(`emmail` does, deliberately, so privileged write access cannot track a floating
branch) does not pick up changes to the reusable workflow until that SHA is
bumped. That is the safer posture, but it has to be bumped by hand, and `emmail`
is not in `server-inventory.json`, so template propagation does not reach it
either.

If the token cannot be minted the workflow **degrades rather than breaking**: it
falls back to `GH_TOKEN`/`github.token`, emits a warning annotation and a step
summary, and keeps auto-merging. Auto-merge still works; only the
downstream-trigger fix is lost. The cancel step keeps that same fallback by
design — if minting fails, every other step is skipped by the implicit
`success()` while cancel still runs on `!cancelled()`, and with an empty token
`gh` would fail on auth and leave an already-armed auto-merge to fire.

**Safety properties of the reusable workflow** (change these only deliberately):

- **The `github.actor` guard is superseded by provenance, and only by provenance.** Some
  repo stubs (`streamdeck-mcp`, `mcp-toggl`, `whatsapp-mcp`) carry
  `github.actor == 'dependabot[bot]'` alongside the author check. That was **deliberate
  caller-side `pull_request_target` hardening**, added to the templates in May 2026 after
  Copilot review of mcp-ecosystem PR #25 — not an oversight, and not to be removed
  casually or re-added blindly. It is safe to drop only because the reusable workflow now
  decides eligibility from who *authored the commits*, which is strictly stronger than who
  triggered the run. So the ordering matters: a stub keeps its actor guard until the
  reusable workflow it calls carries the provenance check below. Since the stubs track
  `@main`, that means merging the provenance change before propagating stub updates.
- **Commit provenance.** Auto-merge is armed only when every commit on the PR head
  matches an allowlist of `author/committer/verified` triples — `dependabot[bot]`
  authored, committed by `dependabot[bot]` or `web-flow`, and carrying a valid
  GitHub signature — checked paginated and failing closed on anything else.
  All three fields are needed. The author alone is not proof of origin, because an
  amend or cherry-pick keeps the original author while whoever rewrote it becomes
  the committer. The committer is not either: GitHub resolves `committer.login`
  from the committer *email*, and `web-flow` is simply the account that owns
  `noreply@github.com`, so anyone with push access can set `GIT_COMMITTER_EMAIL`
  to it. Only the signature cannot be forged — Dependabot's commits are created
  through the API and signed with GitHub's own key, and a maintainer signing under
  that email with their own key fails verification because the address is not a
  verified email on their account.
  Eligibility therefore comes from the commits, not from who triggered the run —
  GitHub only cancels auto-merge itself for pushes by users *without* write access,
  so a maintainer's push would otherwise ride in on an earlier arm. Provenance runs
  on the `workflow_run` pass too, so a human push followed by a green CI run cannot
  re-arm even if that head somehow carries a classification marker.
- **Per-PR, per-event `concurrency` group with `cancel-in-progress`.** Without it,
  two overlapping `synchronize` runs can interleave so the older one re-arms against
  a head it never validated. The group is scoped per event as well as per PR: one
  shared group would let a `workflow_run` CI completion cancel the
  `pull_request_target` run that classifies the head and records its marker, and
  since the retry pass reads that marker rather than re-deriving metadata, the PR
  would be left unarmed — permanently so in a merge-queue repo, where the
  `pull_request_target` path defers enqueueing to the retry.
- **Auto-merge is disarmed before reclassification, not after.** GitHub keeps
  auto-merge armed when the pusher has write access — it disables it automatically
  only for pushes by users *without* write permission — so from the moment a human
  commit or a rebase into a major lands until the job reaches its cancel step, the
  previous head's arm is still live, and a fast green required check could merge the
  new head before it was ever classified. The workflow therefore revokes the arm at
  the top of every `pull_request_target` run and re-arms only once the gate passes.
- **An explicit cancel step**, which disarms auto-merge when a human commit lands
  or a rebase turns the bump into a major. It is now a backstop to the disarm above —
  the step that still runs under `!cancelled()` when classification failed, and where
  a failed best-effort disarm gets a second attempt. It runs on `pull_request_target` only: a
  `workflow_run` completion reports that CI finished, not that anything changed, so
  it has nothing to revoke. Head changes arrive as `synchronize` or `reopened`.
- **Classification is recorded on the head commit, not inferred from labels.** The
  `pull_request_target` pass writes a `dependabot-auto-merge/eligible` commit status
  on the head SHA, and the `workflow_run` retry pass — the one path that cannot call
  `fetch-metadata` — reads that. Labels cannot do this job twice over: they are not
  bound to a commit, so a head that changed from a patch bump to a major could be
  merged off the previous head's `automerge` label whenever CI finished before
  classification relabelled (the event-scoped groups stop the runs cancelling each
  other but do not order the write before the read); and `addLabels` on an
  already-present label emits no timeline event, so "was it labelled recently" would
  report a rebased patch bump as permanently unclassified. The status is only ever
  posted as `success` and only when eligible, so it cannot appear as a red check, and
  posting is best-effort because the degraded fallback token has no `statuses: write`.
  The retry waits for the marker rather than refusing, because no further
  `workflow_run` event would arrive afterwards and a merge-queue repo would never
  enqueue, and it decides on the marker alone — consulting a label as well would put
  arming back on mutable state.
- **There is no manual hold label, deliberately.** `automerge` and
  `needs-human-review` are classifier-owned and rewritten on every classification, so
  a hold placed with either survives only until the next rebase or reopen. A dedicated
  hold label would not be enough on its own: the stubs subscribe to `opened`,
  `reopened`, `synchronize` and `ready_for_review`, not `labeled`, so a hold added
  while checks were pending would go unnoticed until the head next moved — and on a
  queue-enabled repo, disabling auto-merge does not remove an existing queue entry,
  which needs `dequeuePullRequest`. To hold a Dependabot PR durably, close it or use
  `@dependabot ignore`; to stop one already armed, disable auto-merge on the PR, noting
  the next classification re-arms it.
- **Mutually exclusive labels are kept exclusive.** Applying `automerge` or
  `needs-human-review` removes the other one, so the pair always reports a single
  verdict. Otherwise a PR that took a human commit and was then force-updated back to
  a bot-only patch head would carry both at once and the queue would be unreadable at
  a glance. Nothing in the workflow gates on these labels — that is the point of the
  commit-status marker above — so this is about keeping the audit trail honest, not
  about enforcement.
- **`!cancelled()` on that cancel step.** A custom `if:` otherwise carries an
  implicit `success() &&`, so a provenance or metadata failure would skip the
  cancel and leave auto-merge armed — failing open, which is the opposite of what
  the provenance check is for.
- **One eligibility gate** that both the arm and cancel steps derive from, so the
  two cannot disagree. A cancel condition written as the textual inverse of the arm
  condition has to be re-inverted correctly every time either changes, and on the
  `workflow_run` path the arm inputs do not exist at all.

Required checks should target raw GitHub Actions check-run contexts, not the UI
label. For example, require `build-test` or `test` from the GitHub Actions app,
not a display label such as `CI / build-test (pull_request)`.

**PR title enforcement rollout:**

- Templates include `.github/workflows/pr-title.yml`
- The org rulesets do not yet require `Lint PR Title` everywhere because several
  older repos still lack the workflow
- After template propagation aligns the fleet, add `Lint PR Title` to the org CI rulesets

**Managed check-name rollout:**

- Standard TypeScript repos now emit `TypeScript CI`
- Standard Python repos now emit `Python CI`
- PR-title workflows now emit `Lint PR Title`
- Hybrid Python+Go repos keep their explicit names such as `Version Consistency`,
  `Python Lint`, `Go Lint`, `Go Build`, `CodeQL Analysis (Go)`, and
  `Go Vulnerability Check`
- After propagation aligns the fleet, replace legacy org required-check rules
  like `test` with the normalized check contexts above

If one repo needs a stricter or looser Dependabot policy, replace the stub with
the full inline workflow (copied from the reusable source) and modify the `if:`
condition. Don't reference the reusable workflow and add conditions in the same
file — caller stubs can't override `if:` on the callee's jobs.

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

### Test Categories

1. **Unit Tests** - API client methods, utilities
2. **Integration Tests** - Tool handlers with mocked responses
3. **Smoke Tests** - Server startup, tool listing

### TypeScript (Vitest)

```typescript
import { describe, it, expect, vi } from "vitest";

describe("API Client", () => {
  it("should fetch data", async () => {
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

Every v2 tool must have a Zod input schema, an output schema, a human title,
and accurate annotations. Successful results must include both
`structuredContent` and a JSON text block containing the same object. Expected
input, configuration, or upstream failures must return text plus
`isError: true`.

External APIs are not a reason to omit output schemas. Define the stable
envelope and use `z.unknown()` only for genuinely provider-shaped payloads:

```typescript
const outputSchema = z.object({
  accountId: z.string(),
  data: z.unknown(),
});

server.registerTool(
  'get_external_data',
  {
    title: 'Get external data',
    inputSchema: z.object({ accountId: z.string().min(1) }),
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async ({ accountId }) => {
    try {
      const output = { accountId, data: await api.get(accountId) };
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : 'Request failed.' }],
        isError: true,
      };
    }
  },
);
```

Set `readOnlyHint: true` only for operations that cannot mutate external state.
Keep titles, annotations, output schemas, and structured/text output in tests,
including an in-memory MCP client test when practical.

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

  "screenshots": ["assets/screenshots/main-usage.png"],

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
    {
      "name": "tool_name",
      "description": "Detailed description for discoverability"
    }
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
    "mcp",
    "claude",
    "ai-tools",
    "wordpress",
    "{service}",
    "{service}",
    "automation",
    "verygoodplugins"
  ],

  "compatibility": {
    "claude_desktop": ">=1.0.0",
    "platforms": ["darwin", "win32", "linux"],
    "runtimes": { "node": ">=24.0.0" }
  }
}
```

### Key Branding Fields

| Field              | Purpose                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| `long_description` | Markdown content for extension stores - include features, CTAs, VGP branding |
| `icon` / `icons`   | VGP-branded icons (orange #F97316) for UI visibility                         |
| `screenshots`      | Show Claude Desktop using the extension                                      |
| `homepage`         | verygoodplugins.com with UTM tracking (not GitHub)                           |
| `privacy_policies` | Enterprise-readiness signal                                                  |
| `keywords`         | Include "mcp", "claude", "verygoodplugins" for discoverability               |

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
