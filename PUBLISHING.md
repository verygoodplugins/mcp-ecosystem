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

### First-Time Registration

1. **Create `server.json`**:
   ```json
   {
     "$schema": "https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json",
     "name": "io.github.verygoodplugins/mcp-{name}",
     "description": "Brief description of what this server does",
     "version": "1.0.0",
     "packages": [
       {
         "registry_type": "npm",
         "identifier": "@verygoodplugins/mcp-{name}",
         "version": "1.0.0"
       }
     ]
   }
   ```

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

3. **Publish package first** (must be publicly accessible)

4. **Submit to registry**:
   ```bash
   npx @anthropic-ai/mcp publish server.json
   ```

   This will:
   - Validate your server.json
   - Authenticate via GitHub OAuth
   - Submit to the registry

### Updating Registry Entry

When you release a new version:

1. Update version in `server.json`
2. Ensure package is published to npm/PyPI
3. Re-run the publish command:
   ```bash
   npx @anthropic-ai/mcp publish server.json
   ```

---

## Post-Release Checklist

- [ ] Verify package is accessible on npm/PyPI
- [ ] Verify MCP Registry entry is correct
- [ ] Test installation in clean environment
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
