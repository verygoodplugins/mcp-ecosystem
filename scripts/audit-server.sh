#!/bin/bash
# Audit an MCP server against VGP standards
# Usage: ./audit-server.sh <path-to-server>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INVENTORY_FILE="$ROOT_DIR/server-inventory.json"
SERVER_PATH="${1:-.}"
ERRORS=0
WARNINGS=0
SERVER_PROFILE_JSON=""
ALLOWED_PACKAGE_FILES_JSON="[]"
DEFAULT_GITHUB_ORG="${GITHUB_ORG:-verygoodplugins}"

resolve_repo_slug() {
    local server_path="$1"
    local remote_url=""
    local base_name=""

    if git -C "$server_path" rev-parse --git-dir >/dev/null 2>&1; then
        remote_url="$(git -C "$server_path" remote get-url origin 2>/dev/null || true)"
        if [[ -n "$remote_url" ]]; then
            case "$remote_url" in
                git@github.com:*)
                    echo "${remote_url#git@github.com:}" | sed 's/\.git$//'
                    return 0
                    ;;
                https://github.com/*)
                    echo "${remote_url#https://github.com/}" | sed 's/\.git$//'
                    return 0
                    ;;
            esac
        fi
    fi

    base_name="$(basename "$(cd "$server_path" && pwd)")"
    case "$base_name" in
        mcp-*|*-mcp)
            echo "$DEFAULT_GITHUB_ORG/$base_name"
            return 0
            ;;
    esac

    return 1
}

if [[ -d "$SERVER_PATH" ]]; then
    SERVER_PATH="$(cd "$SERVER_PATH" && pwd)"
fi

if git -C "$SERVER_PATH" rev-parse --show-toplevel >/dev/null 2>&1; then
    REPO_ROOT="$(git -C "$SERVER_PATH" rev-parse --show-toplevel)"
else
    REPO_ROOT="$SERVER_PATH"
fi

PACKAGE_ROOT="$SERVER_PATH"
REPO_SLUG_LOOKUP="$(resolve_repo_slug "$REPO_ROOT" 2>/dev/null || true)"
REPO_NAME="$(basename "$REPO_ROOT")"
if [[ -n "$REPO_SLUG_LOOKUP" ]]; then
    REPO_NAME="${REPO_SLUG_LOOKUP##*/}"
fi

if command -v node >/dev/null 2>&1; then
    SERVER_PROFILE_JSON="$(node "$SCRIPT_DIR/describe-server.mjs" "$REPO_NAME" 2>/dev/null || true)"
fi

if [[ -n "$SERVER_PROFILE_JSON" && -x "$(command -v jq 2>/dev/null)" ]]; then
    ALLOWED_PACKAGE_FILES_JSON="$(jq -c '.server.allowedPackageFiles // []' <<<"$SERVER_PROFILE_JSON")"
fi

PACKAGE_PATH=""
if [[ -n "$SERVER_PROFILE_JSON" && -x "$(command -v jq 2>/dev/null)" ]]; then
    PACKAGE_PATH="$(jq -r '.server.packagePath // "."' <<<"$SERVER_PROFILE_JSON")"
elif [[ -f "$INVENTORY_FILE" && -x "$(command -v jq 2>/dev/null)" ]]; then
    PACKAGE_PATH="$(jq -r --arg name "$REPO_NAME" '.servers[] | select(.name == $name) | (.packagePath // .baselinePath // ".")' "$INVENTORY_FILE")"
fi

if [[ -n "$PACKAGE_PATH" && "$PACKAGE_PATH" != "." && -d "$REPO_ROOT/$PACKAGE_PATH" ]]; then
    PACKAGE_ROOT="$REPO_ROOT/$PACKAGE_PATH"
elif [[ ! -f "$PACKAGE_ROOT/package.json" && ! -f "$PACKAGE_ROOT/pyproject.toml" ]]; then
    if [[ -f "$REPO_ROOT/package.json" || -f "$REPO_ROOT/pyproject.toml" ]]; then
        PACKAGE_ROOT="$REPO_ROOT"
    else
        PACKAGE_CANDIDATES=()
        for dir in "$REPO_ROOT"/*; do
            if [[ -d "$dir" && ( -f "$dir/package.json" || -f "$dir/pyproject.toml" ) ]]; then
                PACKAGE_CANDIDATES+=("$dir")
            fi
        done

        if [[ "${#PACKAGE_CANDIDATES[@]}" -eq 1 ]]; then
            PACKAGE_ROOT="${PACKAGE_CANDIDATES[0]}"
        fi
    fi
fi

echo "🔍 Auditing MCP server at: $SERVER_PATH"
echo "================================================"

if [[ "$PACKAGE_ROOT" != "$REPO_ROOT" ]]; then
    echo "📁 Repo root:    $REPO_ROOT"
    echo "📦 Package root: $PACKAGE_ROOT"
fi

# Detect server type
if [[ -f "$PACKAGE_ROOT/package.json" ]]; then
    SERVER_TYPE="typescript"
    echo "📦 Detected: TypeScript/Node.js server"
elif [[ -f "$PACKAGE_ROOT/pyproject.toml" ]]; then
    SERVER_TYPE="python"
    echo "🐍 Detected: Python server"
else
    echo "❌ Could not detect server type (no package.json or pyproject.toml)"
    exit 1
fi

echo ""
echo "📋 Checking required files..."
echo "-----------------------------"

# Check required files
REQUIRED_FILES=("README.md" "LICENSE" "CHANGELOG.md")

for file in "${REQUIRED_FILES[@]}"; do
    if [[ -f "$REPO_ROOT/$file" ]]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
        ((ERRORS += 1))
    fi
done

# Check host-neutral agent instructions (recommended).
if [[ -f "$REPO_ROOT/AGENTS.md" ]]; then
    echo "✅ AGENTS.md exists"
else
    echo "⚠️  AGENTS.md missing (recommended)"
    ((WARNINGS += 1))
fi

if [[ -f "$REPO_ROOT/CLAUDE.md" ]]; then
    echo "✅ CLAUDE.md compatibility entry point exists"
fi

# Check server.json (MCP Registry)
if [[ -f "$REPO_ROOT/server.json" ]]; then
    echo "✅ server.json exists (MCP Registry)"
    
    # Check server.json schema version (must be 2025-12-11)
    if grep -q '2025-12-11' "$REPO_ROOT/server.json"; then
        echo "✅ server.json uses 2025-12-11 schema"
    else
        echo "❌ server.json must use 2025-12-11 schema"
        ((ERRORS += 1))
    fi
    
    # Check repository.source field
    if grep -Eq '"source"[[:space:]]*:[[:space:]]*"github"' "$REPO_ROOT/server.json"; then
        echo "✅ server.json has repository.source: \"github\""
    elif grep -q '"source"' "$REPO_ROOT/server.json"; then
        echo "⚠️  server.json repository.source should be \"github\""
        ((WARNINGS += 1))
    fi
    
    # Check transport is object format
    if node --input-type=module -e 'import fs from "node:fs"; const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.exit(manifest.packages?.every((pkg) => pkg.transport?.type === "stdio") ? 0 : 1);' "$REPO_ROOT/server.json" 2>/dev/null; then
        echo "✅ server.json has correct transport format"
    elif grep -q '"transport"' "$REPO_ROOT/server.json"; then
        echo "⚠️  server.json transport should be { \"type\": \"stdio\" }"
        ((WARNINGS += 1))
    fi
else
    echo "⚠️  server.json missing (needed for MCP Registry)"
    ((WARNINGS += 1))
fi

echo ""
echo "🔧 Checking CI/CD configuration..."
echo "-----------------------------------"

# Check GitHub workflows
WORKFLOWS=("ci.yml" "security.yml" "pr-title.yml" "dependabot-auto-merge.yml")
RELEASE_WORKFLOW="release.yml"
if [[ -n "$SERVER_PROFILE_JSON" && -x "$(command -v jq 2>/dev/null)" ]]; then
    RELEASE_WORKFLOW="$(jq -r '.profiles.release.workflowFile | split("/") | last' <<<"$SERVER_PROFILE_JSON")"
elif [[ "$SERVER_TYPE" == "typescript" ]]; then
    RELEASE_WORKFLOW="release-please.yml"
fi
WORKFLOWS+=("$RELEASE_WORKFLOW")

for workflow in "${WORKFLOWS[@]}"; do
    if [[ -f "$REPO_ROOT/.github/workflows/$workflow" ]]; then
        echo "✅ .github/workflows/$workflow exists"
    else
        echo "❌ .github/workflows/$workflow missing"
        ((ERRORS += 1))
    fi
done

CI_WORKFLOW_PATH="$REPO_ROOT/.github/workflows/ci.yml"
if [[ -f "$CI_WORKFLOW_PATH" ]]; then
    if grep -A1 -E '^[[:space:]]*merge_group:' "$CI_WORKFLOW_PATH" | grep -Eq '^[[:space:]]*types:[[:space:]]*\[checks_requested\]'; then
        echo "✅ .github/workflows/ci.yml explicitly subscribes to merge_group checks"
    else
        echo "❌ .github/workflows/ci.yml must subscribe to merge_group checks_requested"
        ((ERRORS += 1))
    fi
fi

if [[ -f "$REPO_ROOT/.github/dependabot.yml" ]]; then
    echo "✅ .github/dependabot.yml exists"
else
    echo "⚠️  .github/dependabot.yml missing"
    ((WARNINGS += 1))
fi

# GitHub hygiene files (governance + community standards)
HYGIENE_FILES=(
    ".github/CODEOWNERS"
    ".github/SECURITY.md"
    ".github/PULL_REQUEST_TEMPLATE.md"
    ".github/ISSUE_TEMPLATE/config.yml"
    ".github/ISSUE_TEMPLATE/bug_report.yml"
    ".github/ISSUE_TEMPLATE/feature_request.yml"
)
for relpath in "${HYGIENE_FILES[@]}"; do
    if [[ -f "$REPO_ROOT/$relpath" ]]; then
        echo "✅ $relpath exists"
    else
        echo "⚠️  $relpath missing"
        ((WARNINGS += 1))
    fi
done

if [[ -n "$SERVER_PROFILE_JSON" && -x "$(command -v jq 2>/dev/null)" ]]; then
    while IFS= read -r required_file; do
        [[ -z "$required_file" ]] && continue
        if [[ -f "$REPO_ROOT/$required_file" ]]; then
            echo "✅ $required_file exists"
        else
            echo "❌ $required_file missing"
            ((ERRORS += 1))
        fi
    done < <(jq -r '.profiles.release.requiredFiles[]?' <<<"$SERVER_PROFILE_JSON")
fi

echo ""
echo "🌐 Checking GitHub repo defaults..."
echo "-----------------------------------"

if command -v gh >/dev/null 2>&1; then
    REPO_SLUG="$(resolve_repo_slug "$REPO_ROOT" 2>/dev/null || true)"

    if [[ -n "$REPO_SLUG" ]] && gh api "repos/$REPO_SLUG" >/dev/null 2>&1; then
        if [[ "$(gh api "repos/$REPO_SLUG" --jq '.allow_auto_merge')" == "true" ]]; then
            echo "✅ allow_auto_merge enabled"
        else
            echo "⚠️  allow_auto_merge disabled"
            ((WARNINGS += 1))
        fi

        if [[ "$(gh api "repos/$REPO_SLUG" --jq '.delete_branch_on_merge')" == "true" ]]; then
            echo "✅ delete_branch_on_merge enabled"
        else
            echo "⚠️  delete_branch_on_merge disabled"
            ((WARNINGS += 1))
        fi

        if [[ "$(gh api "repos/$REPO_SLUG" --jq '.allow_squash_merge')" == "true" ]]; then
            echo "✅ allow_squash_merge enabled"
        else
            echo "⚠️  allow_squash_merge disabled"
            ((WARNINGS += 1))
        fi

        if gh api "repos/$REPO_SLUG/vulnerability-alerts" >/dev/null 2>&1; then
            echo "✅ vulnerability alerts enabled"
        else
            echo "⚠️  vulnerability alerts disabled"
            ((WARNINGS += 1))
        fi

        if gh api "repos/$REPO_SLUG/automated-security-fixes" >/dev/null 2>&1; then
            echo "✅ automated security fixes enabled"
        else
            echo "⚠️  automated security fixes disabled"
            ((WARNINGS += 1))
        fi
    else
        echo "ℹ️  Skipping GitHub repo checks (repo not reachable via gh)"
    fi
else
    echo "ℹ️  Skipping GitHub repo checks (gh not installed)"
fi

echo ""
echo "📦 Checking package configuration..."
echo "-------------------------------------"

if [[ "$SERVER_TYPE" == "typescript" ]]; then
    # Check package.json fields
    if grep -q '"mcpName"' "$PACKAGE_ROOT/package.json"; then
        echo "✅ mcpName configured"
    else
        echo "❌ mcpName missing in package.json"
        ((ERRORS += 1))
    fi

    if grep -q '"publishConfig"' "$PACKAGE_ROOT/package.json"; then
        echo "✅ publishConfig exists"
    else
        echo "⚠️  publishConfig missing"
        ((WARNINGS += 1))
    fi

    if [[ -n "$SERVER_PROFILE_JSON" && -x "$(command -v jq 2>/dev/null)" ]]; then
        while IFS= read -r required_script; do
            [[ -z "$required_script" ]] && continue
            if jq -e --arg script "$required_script" '.scripts[$script]' "$PACKAGE_ROOT/package.json" >/dev/null 2>&1; then
                echo "✅ package.json script '$required_script' exists"
            else
                echo "❌ package.json script '$required_script' missing"
                ((ERRORS += 1))
            fi
        done < <(jq -r '.profiles.ci.requiredScripts[]?' <<<"$SERVER_PROFILE_JSON")
    elif grep -q '"test"' "$PACKAGE_ROOT/package.json"; then
        echo "✅ test script exists"
    else
        echo "❌ test script missing"
        ((ERRORS += 1))
    fi
    
    # Check files array exists
    if node --input-type=module -e '
        import fs from "node:fs";
        import path from "node:path";

        const [pkgPath, allowedExtrasJson] = process.argv.slice(1);
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
        const root = path.dirname(pkgPath);
        const allowed = new Set([
          "dist",
          "dist/",
          "README.md",
          "LICENSE",
          "CHANGELOG.md",
          ...JSON.parse(allowedExtrasJson),
        ]);
        const files = pkg.files;
        const bins = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {});
        const validBin = (target) =>
          typeof target === "string" &&
          target.startsWith("dist/") &&
          !target.includes("..") &&
          (!fs.existsSync(path.join(root, target)) ||
            (fs.statSync(path.join(root, target)).mode & 0o111) !== 0);
        const valid =
          Array.isArray(files) &&
          files.length > 0 &&
          files.every((file) => allowed.has(file)) &&
          files.some((file) => file === "dist" || file === "dist/") &&
          bins.length > 0 &&
          bins.every(validBin);
        process.exit(valid ? 0 : 1);
      ' "$PACKAGE_ROOT/package.json" "$ALLOWED_PACKAGE_FILES_JSON" 2>/dev/null; then
        echo "✅ package files allowlist and bin targets are restricted"
    else
        echo "❌ package.json must use secure or inventory-approved files and expose a dist/ executable bin"
        ((ERRORS += 1))
    fi

    if command -v npm >/dev/null 2>&1; then
        PACK_JSON="$(cd "$PACKAGE_ROOT" && npm pack --dry-run --json --ignore-scripts 2>/dev/null || true)"
        if [[ -z "$PACK_JSON" ]]; then
            echo "⚠️  Could not inspect npm package contents with npm pack --dry-run"
            ((WARNINGS += 1))
        elif printf '%s' "$PACK_JSON" | node --input-type=module -e 'import fs from "node:fs"; const data = JSON.parse(fs.readFileSync(0, "utf8")); const files = data[0]?.files?.map((entry) => entry.path) ?? []; const unsafe = files.filter((file) => /(^|\/)(\.env(?:\.|$)|node_modules|\.git|\.github|coverage|tests?|src)(\/|$)/.test(file)); if (unsafe.length) { console.error(unsafe.join("\n")); process.exit(1); }' 2>/dev/null; then
            echo "✅ npm pack dry-run contains no source, test, credential, or VCS files"
        else
            echo "❌ npm pack dry-run would include prohibited package content"
            ((ERRORS += 1))
        fi
    else
        echo "⚠️  npm not found; skipping npm package content inspection"
        ((WARNINGS += 1))
    fi

    # Check package-lock.json exists and is not gitignored (required for npm ci)
    if [[ -f "$PACKAGE_ROOT/package-lock.json" ]]; then
        if [[ -f "$PACKAGE_ROOT/.gitignore" ]] && grep -q '^package-lock.json$' "$PACKAGE_ROOT/.gitignore"; then
            echo "❌ package-lock.json is gitignored (CI will fail)"
            ((ERRORS += 1))
        else
            echo "✅ package-lock.json exists and tracked"
        fi
    else
        echo "❌ package-lock.json missing (required for npm ci)"
        ((ERRORS += 1))
    fi
    
    # Check MCP SDK version
    if grep -q '@modelcontextprotocol/server' "$PACKAGE_ROOT/package.json"; then
        SDK_VERSION=$(grep -o '"@modelcontextprotocol/server"[[:space:]]*:[[:space:]]*"[^"]*"' "$PACKAGE_ROOT/package.json" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1)
        if [[ -n "$SDK_VERSION" ]]; then
            # Extract major.minor for comparison
            MAJOR=$(echo "$SDK_VERSION" | cut -d. -f1)
            MINOR=$(echo "$SDK_VERSION" | cut -d. -f2)
            if [[ "$MAJOR" -ge 2 ]]; then
                echo "✅ MCP server package version $SDK_VERSION (>= 2.0.0)"
            else
                echo "⚠️  MCP server package version $SDK_VERSION (recommend >= 2.0.0)"
                ((WARNINGS += 1))
            fi
        else
            echo "⚠️  Could not parse MCP SDK version"
            ((WARNINGS += 1))
        fi
    else
        if grep -q '@modelcontextprotocol/sdk' "$PACKAGE_ROOT/package.json"; then
            echo "⚠️  Legacy @modelcontextprotocol/sdk detected; migrate code and dependencies to @modelcontextprotocol/server v2 together"
            ((WARNINGS += 1))
        else
            echo "❌ No MCP server package found in dependencies"
            ((ERRORS += 1))
        fi
    fi
else
    # Check pyproject.toml fields
    if grep -q '\[tool.mcp\]' "$PACKAGE_ROOT/pyproject.toml"; then
        echo "✅ [tool.mcp] configured"
    else
        echo "❌ [tool.mcp] missing in pyproject.toml"
        ((ERRORS += 1))
    fi

    if grep -q '\[tool.pytest' "$PACKAGE_ROOT/pyproject.toml"; then
        echo "✅ pytest configured"
    else
        echo "⚠️  pytest configuration missing"
        ((WARNINGS += 1))
    fi
    
    # Check ruff configuration
    if grep -q '\[tool.ruff\]' "$PACKAGE_ROOT/pyproject.toml"; then
        echo "✅ ruff configured"
    else
        echo "⚠️  ruff configuration missing"
        ((WARNINGS += 1))
    fi
    
    # Check Python version requirement
    if grep -q 'requires-python\s*=\s*">=3.11"' "$PACKAGE_ROOT/pyproject.toml"; then
        echo "✅ requires-python >= 3.11"
    elif grep -q 'requires-python' "$PACKAGE_ROOT/pyproject.toml"; then
        echo "⚠️  requires-python should be >= 3.11"
        ((WARNINGS += 1))
    else
        echo "⚠️  requires-python not specified"
        ((WARNINGS += 1))
    fi
fi

echo ""
echo "⚙️  Checking config files..."
echo "----------------------------"

if [[ "$SERVER_TYPE" == "typescript" ]]; then
    # Check tsconfig.json
    if [[ -f "$PACKAGE_ROOT/tsconfig.json" ]]; then
        echo "✅ tsconfig.json exists"
        
        # Check for strict mode
        if grep -Eq '"strict"[[:space:]]*:[[:space:]]*true' "$PACKAGE_ROOT/tsconfig.json"; then
            echo "✅ tsconfig.json has strict: true"
        else
            echo "⚠️  tsconfig.json should have strict: true"
            ((WARNINGS += 1))
        fi
        
        # Check for ES2022 target
        if grep -Eq '"target"[[:space:]]*:[[:space:]]*"ES2022"' "$PACKAGE_ROOT/tsconfig.json"; then
            echo "✅ tsconfig.json targets ES2022"
        else
            echo "⚠️  tsconfig.json should target ES2022"
            ((WARNINGS += 1))
        fi
    else
        echo "❌ tsconfig.json missing"
        ((ERRORS += 1))
    fi
    
    # Check ESLint config (flat config)
    if [[ -f "$PACKAGE_ROOT/eslint.config.mjs" ]]; then
        echo "✅ eslint.config.mjs exists (flat config)"
    elif [[ -f "$PACKAGE_ROOT/eslint.config.js" ]]; then
        echo "✅ eslint.config.js exists (flat config)"
    elif [[ -f "$PACKAGE_ROOT/.eslintrc.json" || -f "$PACKAGE_ROOT/.eslintrc.js" || -f "$PACKAGE_ROOT/.eslintrc" ]]; then
        echo "⚠️  Legacy ESLint config found (migrate to flat config eslint.config.mjs)"
        ((WARNINGS += 1))
    else
        echo "⚠️  No ESLint config found"
        ((WARNINGS += 1))
    fi
    
    # Check Prettier config
    if [[ -f "$PACKAGE_ROOT/.prettierrc" || -f "$PACKAGE_ROOT/.prettierrc.json" || -f "$PACKAGE_ROOT/prettier.config.js" ]]; then
        echo "✅ Prettier config exists"
    else
        echo "⚠️  No Prettier config found"
        ((WARNINGS += 1))
    fi
    
    # Check vitest config
    if [[ -f "$PACKAGE_ROOT/vitest.config.ts" || -f "$PACKAGE_ROOT/vitest.config.js" ]]; then
        echo "✅ Vitest config exists"
    else
        echo "⚠️  No Vitest config found (tests may use defaults)"
        ((WARNINGS += 1))
    fi
fi

echo ""
echo "🧵 StdIO stream checks..."
echo "--------------------------"

if [[ -d "$PACKAGE_ROOT/src" ]]; then
    if [[ "$SERVER_TYPE" == "typescript" ]]; then
        # StdIO protocol runs over stdout. Any extra stdout output corrupts MCP.
        if grep -rE 'console\.(log|info|debug)\s*\(' "$PACKAGE_ROOT/src" > /dev/null 2>&1; then
            echo "❌ Found console.log/info/debug in src/ (writes to stdout and can break MCP stdio)"
            grep -rEn 'console\.(log|info|debug)\s*\(' "$PACKAGE_ROOT/src" | head -5
            ((ERRORS += 1))
        else
            echo "✅ No console.log/info/debug in src/"
        fi

        if grep -rE 'process\.stdout\.write\s*\(' "$PACKAGE_ROOT/src" > /dev/null 2>&1; then
            echo "❌ Found process.stdout.write in src/ (can break MCP stdio)"
            grep -rEn 'process\.stdout\.write\s*\(' "$PACKAGE_ROOT/src" | head -5
            ((ERRORS += 1))
        else
            echo "✅ No process.stdout.write in src/"
        fi

        if grep -rE "from 'dotenv'|require\\(['\"]dotenv['\"]\\)" "$PACKAGE_ROOT/src" > /dev/null 2>&1; then
            if grep -rE 'config\\(\\)\\s*;\\s*$' "$PACKAGE_ROOT/src" > /dev/null 2>&1; then
                echo "⚠️  dotenv config() called without { quiet: true } (dotenv@17 may log to stdout)"
                grep -rEn 'config\\(\\)\\s*;\\s*$' "$PACKAGE_ROOT/src" | head -5
                ((WARNINGS += 1))
            else
                echo "✅ dotenv usage does not include bare config()"
            fi
        fi
    else
        # Python: avoid print() to stdout when using stdio_server transport.
        if grep -rE '\\bprint\\s*\\(' "$PACKAGE_ROOT/src" > /dev/null 2>&1; then
            echo "❌ Found print() in src/ (stdout is reserved for MCP stdio)"
            grep -rEn '\\bprint\\s*\\(' "$PACKAGE_ROOT/src" | head -5
            ((ERRORS += 1))
        else
            echo "✅ No print() in src/"
        fi
    fi
else
    echo "ℹ️  No src/ directory to check for stdio issues"
fi

echo ""
echo "📖 Checking README structure..."
echo "--------------------------------"

if [[ "$SERVER_TYPE" == "typescript" && -d "$PACKAGE_ROOT/src" ]]; then
    if command -v node >/dev/null 2>&1; then
        MCP_TOOL_COUNTS="$(node "$SCRIPT_DIR/lib/audit-mcp-v2-tools.mjs" "$PACKAGE_ROOT/src")"
        IFS='|' read -r MCP_TOOL_COUNT MCP_RESULT_MISSING MCP_ERROR_MISSING MCP_ANNOTATION_MISSING <<< "$MCP_TOOL_COUNTS"
    else
        echo "ℹ️  MCP v2 tool contract audit skipped because Node is unavailable"
    fi
fi

if [[ "${MCP_TOOL_COUNT:-0}" -gt 0 ]]; then
    echo ""
    echo "🧩 Checking MCP v2 tool contracts..."
    echo "------------------------------------"

    if [[ "$MCP_RESULT_MISSING" -eq 0 ]]; then
        echo "✅ Every tool registration includes title, inputSchema, outputSchema, and matching JSON/structured output"
    else
        echo "⚠️  MCP v2 tools should declare outputSchema and return structuredContent with matching JSON text; title and inputSchema are also required"
        ((WARNINGS += 1))
    fi

    if [[ "$MCP_ERROR_MISSING" -eq 0 ]]; then
        echo "✅ Every tool handler represents expected failures with MCP isError results"
    else
        echo "⚠️  Tool handlers should return isError: true for expected input, configuration, and upstream failures"
        ((WARNINGS += 1))
    fi

    if [[ "$MCP_ANNOTATION_MISSING" -eq 0 ]]; then
        echo "✅ Every tool annotation declares readOnlyHint and destructiveHint"
    else
        echo "⚠️  Tool annotations should explicitly declare readOnlyHint and destructiveHint"
        ((WARNINGS += 1))
    fi
fi

if [[ "$SERVER_TYPE" == "typescript" && -f "$REPO_ROOT/.github/workflows/$RELEASE_WORKFLOW" && -f "$REPO_ROOT/server.json" ]]; then
    RELEASE_PATH="$REPO_ROOT/.github/workflows/$RELEASE_WORKFLOW"
    MCP_REGISTRY_JOB="$(awk '
        /^  mcp-registry-publish:/ { in_registry_job = 1 }
        in_registry_job && /^  [[:alnum:]_-]+:/ && $1 != "mcp-registry-publish:" { exit }
        in_registry_job { print }
    ' "$RELEASE_PATH")"
    if [[ -n "$MCP_REGISTRY_JOB" ]] && grep -q 'needs: \[release-please, npm-publish\]' <<< "$MCP_REGISTRY_JOB" && grep -q 'mcp-publisher login github-oidc' <<< "$MCP_REGISTRY_JOB"; then
        echo "✅ MCP Registry publication is coupled to successful npm publication"
    else
        echo "⚠️  Release workflow should publish the registry manifest after npm publication using GitHub OIDC"
        ((WARNINGS += 1))
    fi
fi

if [[ -f "$REPO_ROOT/README.md" ]]; then
    # Check for Support section
    if grep -qi '^##.*support' "$REPO_ROOT/README.md"; then
        echo "✅ README has Support section"
    else
        echo "⚠️  README missing Support section"
        ((WARNINGS += 1))
    fi
    
    # Check for orange heart footer
    if grep -q '🧡' "$REPO_ROOT/README.md"; then
        echo "✅ README has orange heart footer"
    else
        echo "⚠️  README missing orange heart (🧡) footer"
        ((WARNINGS += 1))
    fi
    
    # Check for VGP attribution
    if grep -qi 'very good plugins' "$REPO_ROOT/README.md"; then
        echo "✅ README has VGP attribution"
    else
        echo "⚠️  README missing VGP attribution"
        ((WARNINGS += 1))
    fi
fi

echo ""
echo "🔗 Checking UTM links in README..."
echo "-----------------------------------"

if [[ -f "$REPO_ROOT/README.md" ]]; then
    # Check for external links without UTM
    if grep -E 'https://(verygoodplugins|wpfusion|automem)\.com[^[:space:]"<)]*' "$REPO_ROOT/README.md" | grep -Ev '\?[^[:space:]"<)]*utm_source=' > /dev/null 2>&1; then
        echo "⚠️  Found links without UTM tracking"
        grep -E 'https://(verygoodplugins|wpfusion|automem)\.com[^[:space:]"<)]*' "$REPO_ROOT/README.md" | grep -Ev '\?[^[:space:]"<)]*utm_source=' | head -3
        ((WARNINGS += 1))
    else
        echo "✅ All external links have UTM (or none found)"
    fi
fi

echo ""
echo "🔒 Security checks..."
echo "----------------------"

# Check for potential secrets
if [[ -d "$PACKAGE_ROOT/src" ]]; then
    SECRET_ASSIGNMENT_PATTERN="(api_key|apikey|password|secret|token)[[:space:]]*[:=][[:space:]]*[\"'][^\"']{8,}[\"']"
    if grep -rE --exclude='*.test.*' --exclude='*.spec.*' --exclude='.env*' "$SECRET_ASSIGNMENT_PATTERN" "$PACKAGE_ROOT/src" > /dev/null 2>&1; then
        echo "⚠️  Potential hardcoded secrets found"
        ((WARNINGS += 1))
    else
        echo "✅ No obvious hardcoded secrets"
    fi
else
    echo "ℹ️  No src/ directory to check for secrets"
fi

# Check for .env in git
if [[ -f "$PACKAGE_ROOT/.gitignore" ]] && grep -q '.env' "$PACKAGE_ROOT/.gitignore"; then
    echo "✅ .env in .gitignore"
else
    echo "⚠️  .env may not be in .gitignore"
    ((WARNINGS += 1))
fi

# Check CodeQL action pin.
if [[ -f "$REPO_ROOT/.github/workflows/security.yml" ]]; then
    if grep -q 'github/codeql-action/.*@988661ebb5e81487b3fb31b2185d2856c0a10679' "$REPO_ROOT/.github/workflows/security.yml"; then
        echo "✅ CodeQL Action v4 is SHA-pinned"
    else
        echo "⚠️  CodeQL Action should use the approved SHA pin"
        ((WARNINGS += 1))
    fi
fi

echo ""
echo "📦 Desktop Extension (optional)..."
echo "-----------------------------------"

# Check for Desktop Extension manifest (optional)
if [[ -f "$REPO_ROOT/manifest.json" ]]; then
    echo "✅ Desktop Extension manifest exists"
    
    # Check manifest_version
    if grep -q '"manifest_version":\s*"0.2"' "$REPO_ROOT/manifest.json"; then
        echo "✅ manifest_version is 0.2"
    elif grep -q '"manifest_version"' "$REPO_ROOT/manifest.json"; then
        echo "⚠️  manifest_version should be \"0.2\""
        ((WARNINGS += 1))
    fi
    
    # Check for user_config
    if grep -q '"user_config"' "$REPO_ROOT/manifest.json"; then
        echo "✅ user_config defined"
    else
        echo "⚠️  user_config missing (needed for configuration UI)"
        ((WARNINGS += 1))
    fi
    
    # Check if build script exists
    if [[ "$SERVER_TYPE" == "typescript" ]] && grep -q '"build:extension"' "$PACKAGE_ROOT/package.json"; then
        echo "✅ build:extension script exists"
    elif [[ "$SERVER_TYPE" == "typescript" ]]; then
        echo "⚠️  build:extension script missing (add to package.json)"
        ((WARNINGS += 1))
    fi
    
    # Check for .mcpbignore
    if [[ -f "$REPO_ROOT/.mcpbignore" ]]; then
        echo "✅ .mcpbignore exists (reduces bundle size)"
    else
        echo "⚠️  .mcpbignore missing (extension bundle may be large)"
        ((WARNINGS += 1))
    fi
else
    echo "ℹ️  No Desktop Extension (optional for non-technical users)"
fi

echo ""
echo "================================================"
echo "📊 Audit Summary"
echo "================================================"
echo "❌ Errors:   $ERRORS"
echo "⚠️  Warnings: $WARNINGS"
echo ""

if [[ $ERRORS -gt 0 ]]; then
    echo "🔴 Server does not meet minimum standards. Fix errors above."
    exit 1
elif [[ $WARNINGS -gt 0 ]]; then
    echo "🟡 Server meets minimum standards but has warnings."
    exit 0
else
    echo "🟢 Server meets all standards!"
    exit 0
fi
