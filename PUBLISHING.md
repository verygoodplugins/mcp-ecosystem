# MCP Server Publishing Checklist

Use this checklist when publishing a new MCP server or updating an existing one.

## Pre-Release Checklist

### Code Quality
- [ ] All tests passing (`npm test` / `pytest`)
- [ ] Linting passes (`npm run lint` / `ruff check .`)
- [ ] No TypeScript/Python errors
- [ ] Code coverage ≥50%

### Documentation
- [ ] README.md complete with:
  - [ ] Installation instructions
  - [ ] Configuration options
  - [ ] Tool descriptions
  - [ ] Usage examples
  - [ ] UTM links (`?utm_source=github`)
- [ ] CLAUDE.md exists for AI assistance
- [ ] CHANGELOG.md up to date
- [ ] LICENSE file exists (MIT or GPL-3.0)

### Package Configuration
- [ ] Version number updated
- [ ] `mcpName` set in package.json/pyproject.toml
- [ ] `engines` or `requires-python` set correctly
- [ ] `publishConfig.access` set to "public" (npm)
- [ ] `files` array includes only necessary files

### CI/CD
- [ ] `.github/workflows/ci.yml` exists
- [ ] `.github/workflows/release-please.yml` or `release.yml` exists
- [ ] `.github/workflows/security.yml` exists
- [ ] `.github/dependabot.yml` exists

### Security
- [ ] No hardcoded secrets
- [ ] All secrets in environment variables
- [ ] `npm audit` / `pip-audit` shows no high/critical issues
- [ ] Input validation on all tool arguments

---

## npm Publishing (TypeScript)

### First-Time Setup

1. **Create npm package** (if new):
   ```bash
   npm login
   npm publish --access public
   ```

2. **Configure Trusted Publishing**:
   - Go to https://www.npmjs.com/package/@verygoodplugins/mcp-{name}/access
   - Click "Manage Trusted Publishers"
   - Add GitHub Actions:
     - Owner: `verygoodplugins`
     - Repository: `mcp-{name}`
     - Workflow: `release-please.yml`
     - Environment: (leave blank)

3. **Verify provenance**:
   After first automated publish, check npm page for provenance badge.

### Subsequent Releases

Releases are automatic via release-please:

1. Commit with conventional commit message:
   ```bash
   git commit -m "feat: add new tool for X"
   git push origin main
   ```

2. Release-please creates a "Release PR" automatically

3. Merge the Release PR to:
   - Bump version in package.json
   - Update CHANGELOG.md
   - Create GitHub Release
   - Publish to npm

---

## PyPI Publishing (Python)

### First-Time Setup

1. **Create PyPI account** at https://pypi.org/

2. **Configure Trusted Publishing**:
   - Go to https://pypi.org/manage/project/{package-name}/settings/publishing/
   - Add trusted publisher:
     - Owner: `verygoodplugins`
     - Repository: `mcp-{name}`
     - Workflow: `release.yml`
     - Environment: `pypi`

3. **Create GitHub environment**:
   - Go to repo Settings → Environments
   - Create environment named `pypi`
   - No additional configuration needed

### Subsequent Releases

1. Update version in `pyproject.toml`

2. Create and push a git tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. GitHub Action automatically:
   - Builds package
   - Publishes to PyPI
   - Creates GitHub Release

---

## MCP Registry Publishing

### First-Time Setup (One-Time)

1. **Clone and build the MCP Publisher CLI**:
   ```bash
   git clone https://github.com/modelcontextprotocol/registry ~/mcp-registry
   cd ~/mcp-registry
   make publisher
   ```

2. **Add to PATH** (optional):
   ```bash
   # Add to ~/.zshrc or ~/.bashrc
   export PATH="$HOME/mcp-registry/bin:$PATH"
   ```

### First-Time Registration

1. **Create `server.json`** (use 2025-12-11 schema):
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

   **Critical requirements:**
   - `repository.source` must be `"github"` (not `type: "git"`)
   - `transport` must be object: `{ "type": "stdio" }`
   - All field names are camelCase (`registryType` not `registry_type`)
   - `description` must be under 100 characters

2. **Add mcpName to package**:

   TypeScript (package.json):
   ```json
   {
     "mcpName": "io.github.verygoodplugins/mcp-{name}"
   }
   ```

   Python (pyproject.toml):
   ```toml
   [tool.mcp]
   name = "io.github.verygoodplugins/mcp-{name}"
   ```

3. **Publish package first** (must be publicly accessible on npm/PyPI)

4. **Submit to registry**:
   ```bash
   cd /path/to/your/server
   ~/mcp-registry/bin/mcp-publisher publish server.json
   ```

   This will:
   - Validate your server.json against the schema
   - Authenticate via GitHub OAuth (opens browser)
   - Submit to the MCP Registry

### Updating Registry Entry

When you release a new version:

1. Update version in `server.json`
2. Ensure package is published to npm/PyPI
3. Re-run the publish command:
   ```bash
   ~/mcp-registry/bin/mcp-publisher publish server.json
   ```

---

## Desktop Extension Publishing (Optional)

Desktop Extensions provide one-click installation for Claude Desktop users. This is optional but recommended for servers targeting non-technical users.

**Reference:** [Anthropic Desktop Extensions Guide](https://www.anthropic.com/engineering/desktop-extensions)

### First-Time Setup

1. **Install the mcpb CLI** (one-time):
   ```bash
   npm install -g @anthropic-ai/mcpb
   ```

2. **Create extension manifest** (`manifest.json` in project root):
   ```json
   {
     "manifest_version": "0.2",
     "name": "mcp-{name}",
     "display_name": "Human Readable Name",
     "version": "1.0.0",
     "description": "Brief description",
     "author": { "name": "Very Good Plugins" },
     "server": {
       "type": "node",
       "entry_point": "dist/index.js",
       "mcp_config": {
         "command": "node",
         "args": ["${__dirname}/dist/index.js"],
         "env": { "API_KEY": "${user_config.api_key}" }
       }
     },
     "user_config": {
       "api_key": {
         "type": "string",
         "title": "API Key",
         "sensitive": true,
         "required": true
       }
     }
   }
   ```

3. **Create `.mcpbignore`** to exclude dev dependencies:
   ```
   src/
   tests/
   *.ts
   node_modules/typescript/
   node_modules/@types/
   node_modules/jest*/
   node_modules/eslint*/
   .git/
   .github/
   ```

4. **Create brand assets** in `assets/` directory:
   ```
   assets/
   ├── icon.png              # 128x128 primary (VGP orange #F97316)
   └── screenshots/
       └── main-usage.png    # Claude Desktop in action
   ```

   **Icon guidelines:**
   - 128x128 PNG with transparent background
   - VGP orange (#F97316) as accent color
   - Simple design that reads well at small sizes

   **Screenshot guidelines:**
   - 1280x800 or similar aspect ratio
   - Show Claude Desktop UI with tool in use
   - Blur any sensitive data

5. **Add build script** to package.json:
   ```json
   {
     "scripts": {
       "build:extension": "npm run build && npx @anthropic-ai/mcpb pack"
     }
   }
   ```

### Building the Extension

```bash
npm run build:extension
```

This creates `mcp-{name}-{version}.mcpb` in the project root.

### Testing Locally

1. Build the extension
2. Double-click the `.mcpb` file to install in Claude Desktop
3. Verify configuration prompts appear correctly
4. Test that tools work as expected

### Automated Releases

To automatically build and attach extensions to GitHub releases, add this job to your release workflow:

```yaml
# In .github/workflows/release-please.yml
build-extension:
  needs: release-please
  if: ${{ needs.release-please.outputs.release_created }}
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
    - run: npm ci
    - run: npm run build:extension
    - name: Upload Extension to Release
      uses: softprops/action-gh-release@v2
      with:
        tag_name: ${{ needs.release-please.outputs.tag_name }}
        files: "*.mcpb"
```

### README Installation Section

Add to your README.md:

```markdown
### Quick Install (Claude Desktop)

Download the latest Desktop Extension for one-click installation:

[Download mcp-{name}.mcpb](https://github.com/verygoodplugins/mcp-{name}/releases/latest)

Double-click the downloaded file to install. You'll be prompted for your API key.
```

---

## Post-Release Checklist

- [ ] Verify package is accessible on npm/PyPI
- [ ] Verify MCP Registry entry is correct
- [ ] Test installation in clean environment
- [ ] (Optional) Test Desktop Extension installation
- [ ] Announce on Slack (automatic via workflow)
- [ ] Consider X/Twitter announcement for major releases
- [ ] Update any documentation sites

---

## Troubleshooting

### npm publish fails with 403
- Check Trusted Publishing configuration
- Verify workflow name matches exactly
- Ensure `id-token: write` permission is set

### PyPI publish fails
- Check Trusted Publishing configuration
- Verify `pypi` environment exists
- Ensure package name is available

### MCP Registry submission fails
- Verify package is publicly accessible first
- Check namespace ownership (must be logged in as owner)
- Ensure server.json schema is correct
- Verify version matches published package

### Release-please not creating PR
- Check for conventional commit messages
- Verify push was to `main` branch
- Check Actions tab for workflow runs
