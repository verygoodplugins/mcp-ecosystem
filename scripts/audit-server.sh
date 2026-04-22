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
        ((ERRORS++))
    fi
done

# Check CLAUDE.md (recommended)
if [[ -f "$REPO_ROOT/CLAUDE.md" ]]; then
    echo "✅ CLAUDE.md exists"
else
    echo "⚠️  CLAUDE.md missing (recommended)"
    ((WARNINGS++))
fi

# Check server.json (MCP Registry)
if [[ -f "$REPO_ROOT/server.json" ]]; then
    echo "✅ server.json exists (MCP Registry)"
    
    # Check server.json schema version (must be 2025-12-11)
    if grep -q '2025-12-11' "$REPO_ROOT/server.json"; then
        echo "✅ server.json uses 2025-12-11 schema"
    else
        echo "❌ server.json must use 2025-12-11 schema"
        ((ERRORS++))
    fi
    
    # Check repository.source field
    if grep -q '"source":\s*"github"' "$REPO_ROOT/server.json"; then
        echo "✅ server.json has repository.source: \"github\""
    elif grep -q '"source"' "$REPO_ROOT/server.json"; then
        echo "⚠️  server.json repository.source should be \"github\""
        ((WARNINGS++))
    fi
    
    # Check transport is object format
    if grep -q '"transport":\s*{\s*"type"' "$REPO_ROOT/server.json"; then
        echo "✅ server.json has correct transport format"
    elif grep -q '"transport"' "$REPO_ROOT/server.json"; then
        echo "⚠️  server.json transport should be { \"type\": \"stdio\" }"
        ((WARNINGS++))
    fi
else
    echo "⚠️  server.json missing (needed for MCP Registry)"
    ((WARNINGS++))
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
        ((ERRORS++))
    fi
done

if [[ -f "$REPO_ROOT/.github/dependabot.yml" ]]; then
    echo "✅ .github/dependabot.yml exists"
else
    echo "⚠️  .github/dependabot.yml missing"
    ((WARNINGS++))
fi

if [[ -n "$SERVER_PROFILE_JSON" && -x "$(command -v jq 2>/dev/null)" ]]; then
    while IFS= read -r required_file; do
        [[ -z "$required_file" ]] && continue
        if [[ -f "$REPO_ROOT/$required_file" ]]; then
            echo "✅ $required_file exists"
        else
            echo "❌ $required_file missing"
            ((ERRORS++))
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
            ((WARNINGS++))
        fi

        if [[ "$(gh api "repos/$REPO_SLUG" --jq '.delete_branch_on_merge')" == "true" ]]; then
            echo "✅ delete_branch_on_merge enabled"
        else
            echo "⚠️  delete_branch_on_merge disabled"
            ((WARNINGS++))
        fi

        if [[ "$(gh api "repos/$REPO_SLUG" --jq '.allow_squash_merge')" == "true" ]]; then
            echo "✅ allow_squash_merge enabled"
        else
            echo "⚠️  allow_squash_merge disabled"
            ((WARNINGS++))
        fi

        if gh api "repos/$REPO_SLUG/vulnerability-alerts" >/dev/null 2>&1; then
            echo "✅ vulnerability alerts enabled"
        else
            echo "⚠️  vulnerability alerts disabled"
            ((WARNINGS++))
        fi

        if gh api "repos/$REPO_SLUG/automated-security-fixes" >/dev/null 2>&1; then
            echo "✅ automated security fixes enabled"
        else
            echo "⚠️  automated security fixes disabled"
            ((WARNINGS++))
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
        ((ERRORS++))
    fi

    if grep -q '"publishConfig"' "$PACKAGE_ROOT/package.json"; then
        echo "✅ publishConfig exists"
    else
        echo "⚠️  publishConfig missing"
        ((WARNINGS++))
    fi

    if [[ -n "$SERVER_PROFILE_JSON" && -x "$(command -v jq 2>/dev/null)" ]]; then
        while IFS= read -r required_script; do
            [[ -z "$required_script" ]] && continue
            if jq -e --arg script "$required_script" '.scripts[$script]' "$PACKAGE_ROOT/package.json" >/dev/null 2>&1; then
                echo "✅ package.json script '$required_script' exists"
            else
                echo "❌ package.json script '$required_script' missing"
                ((ERRORS++))
            fi
        done < <(jq -r '.profiles.ci.requiredScripts[]?' <<<"$SERVER_PROFILE_JSON")
    elif grep -q '"test"' "$PACKAGE_ROOT/package.json"; then
        echo "✅ test script exists"
    else
        echo "❌ test script missing"
        ((ERRORS++))
    fi
    
    # Check files array exists
    if grep -q '"files"' "$PACKAGE_ROOT/package.json"; then
        echo "✅ files array configured"
    else
        echo "⚠️  files array missing (controls what's published to npm)"
        ((WARNINGS++))
    fi

    # Check package-lock.json exists and is not gitignored (required for npm ci)
    if [[ -f "$PACKAGE_ROOT/package-lock.json" ]]; then
        if [[ -f "$PACKAGE_ROOT/.gitignore" ]] && grep -q '^package-lock.json$' "$PACKAGE_ROOT/.gitignore"; then
            echo "❌ package-lock.json is gitignored (CI will fail)"
            ((ERRORS++))
        else
            echo "✅ package-lock.json exists and tracked"
        fi
    else
        echo "❌ package-lock.json missing (required for npm ci)"
        ((ERRORS++))
    fi
    
    # Check MCP SDK version
    if grep -q '@modelcontextprotocol/sdk' "$PACKAGE_ROOT/package.json"; then
        SDK_VERSION=$(grep -o '"@modelcontextprotocol/sdk":\s*"[^"]*"' "$PACKAGE_ROOT/package.json" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1)
        if [[ -n "$SDK_VERSION" ]]; then
            # Extract major.minor for comparison
            MAJOR=$(echo "$SDK_VERSION" | cut -d. -f1)
            MINOR=$(echo "$SDK_VERSION" | cut -d. -f2)
            if [[ "$MAJOR" -ge 1 && "$MINOR" -ge 25 ]] || [[ "$MAJOR" -gt 1 ]]; then
                echo "✅ MCP SDK version $SDK_VERSION (>= 1.25.1)"
            else
                echo "⚠️  MCP SDK version $SDK_VERSION (recommend >= 1.25.1)"
                ((WARNINGS++))
            fi
        else
            echo "⚠️  Could not parse MCP SDK version"
            ((WARNINGS++))
        fi
    else
        echo "❌ @modelcontextprotocol/sdk not found in dependencies"
        ((ERRORS++))
    fi
else
    # Check pyproject.toml fields
    if grep -q '\[tool.mcp\]' "$PACKAGE_ROOT/pyproject.toml"; then
        echo "✅ [tool.mcp] configured"
    else
        echo "❌ [tool.mcp] missing in pyproject.toml"
        ((ERRORS++))
    fi

    if grep -q '\[tool.pytest' "$PACKAGE_ROOT/pyproject.toml"; then
        echo "✅ pytest configured"
    else
        echo "⚠️  pytest configuration missing"
        ((WARNINGS++))
    fi
    
    # Check ruff configuration
    if grep -q '\[tool.ruff\]' "$PACKAGE_ROOT/pyproject.toml"; then
        echo "✅ ruff configured"
    else
        echo "⚠️  ruff configuration missing"
        ((WARNINGS++))
    fi
    
    # Check Python version requirement
    if grep -q 'requires-python\s*=\s*">=3.11"' "$PACKAGE_ROOT/pyproject.toml"; then
        echo "✅ requires-python >= 3.11"
    elif grep -q 'requires-python' "$PACKAGE_ROOT/pyproject.toml"; then
        echo "⚠️  requires-python should be >= 3.11"
        ((WARNINGS++))
    else
        echo "⚠️  requires-python not specified"
        ((WARNINGS++))
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
        if grep -q '"strict":\s*true' "$PACKAGE_ROOT/tsconfig.json"; then
            echo "✅ tsconfig.json has strict: true"
        else
            echo "⚠️  tsconfig.json should have strict: true"
            ((WARNINGS++))
        fi
        
        # Check for ES2022 target
        if grep -q '"target":\s*"ES2022"' "$PACKAGE_ROOT/tsconfig.json"; then
            echo "✅ tsconfig.json targets ES2022"
        else
            echo "⚠️  tsconfig.json should target ES2022"
            ((WARNINGS++))
        fi
    else
        echo "❌ tsconfig.json missing"
        ((ERRORS++))
    fi
    
    # Check ESLint config (flat config)
    if [[ -f "$PACKAGE_ROOT/eslint.config.mjs" ]]; then
        echo "✅ eslint.config.mjs exists (flat config)"
    elif [[ -f "$PACKAGE_ROOT/eslint.config.js" ]]; then
        echo "✅ eslint.config.js exists (flat config)"
    elif [[ -f "$PACKAGE_ROOT/.eslintrc.json" || -f "$PACKAGE_ROOT/.eslintrc.js" || -f "$PACKAGE_ROOT/.eslintrc" ]]; then
        echo "⚠️  Legacy ESLint config found (migrate to flat config eslint.config.mjs)"
        ((WARNINGS++))
    else
        echo "⚠️  No ESLint config found"
        ((WARNINGS++))
    fi
    
    # Check Prettier config
    if [[ -f "$PACKAGE_ROOT/.prettierrc" || -f "$PACKAGE_ROOT/.prettierrc.json" || -f "$PACKAGE_ROOT/prettier.config.js" ]]; then
        echo "✅ Prettier config exists"
    else
        echo "⚠️  No Prettier config found"
        ((WARNINGS++))
    fi
    
    # Check vitest config
    if [[ -f "$PACKAGE_ROOT/vitest.config.ts" || -f "$PACKAGE_ROOT/vitest.config.js" ]]; then
        echo "✅ Vitest config exists"
    else
        echo "⚠️  No Vitest config found (tests may use defaults)"
        ((WARNINGS++))
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
            ((ERRORS++))
        else
            echo "✅ No console.log/info/debug in src/"
        fi

        if grep -rE 'process\.stdout\.write\s*\(' "$PACKAGE_ROOT/src" > /dev/null 2>&1; then
            echo "❌ Found process.stdout.write in src/ (can break MCP stdio)"
            grep -rEn 'process\.stdout\.write\s*\(' "$PACKAGE_ROOT/src" | head -5
            ((ERRORS++))
        else
            echo "✅ No process.stdout.write in src/"
        fi

        if grep -rE "from 'dotenv'|require\\(['\"]dotenv['\"]\\)" "$PACKAGE_ROOT/src" > /dev/null 2>&1; then
            if grep -rE 'config\\(\\)\\s*;\\s*$' "$PACKAGE_ROOT/src" > /dev/null 2>&1; then
                echo "⚠️  dotenv config() called without { quiet: true } (dotenv@17 may log to stdout)"
                grep -rEn 'config\\(\\)\\s*;\\s*$' "$PACKAGE_ROOT/src" | head -5
                ((WARNINGS++))
            else
                echo "✅ dotenv usage does not include bare config()"
            fi
        fi
    else
        # Python: avoid print() to stdout when using stdio_server transport.
        if grep -rE '\\bprint\\s*\\(' "$PACKAGE_ROOT/src" > /dev/null 2>&1; then
            echo "❌ Found print() in src/ (stdout is reserved for MCP stdio)"
            grep -rEn '\\bprint\\s*\\(' "$PACKAGE_ROOT/src" | head -5
            ((ERRORS++))
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

if [[ -f "$REPO_ROOT/README.md" ]]; then
    # Check for Support section
    if grep -qi '^##.*support' "$REPO_ROOT/README.md"; then
        echo "✅ README has Support section"
    else
        echo "⚠️  README missing Support section"
        ((WARNINGS++))
    fi
    
    # Check for orange heart footer
    if grep -q '🧡' "$REPO_ROOT/README.md"; then
        echo "✅ README has orange heart footer"
    else
        echo "⚠️  README missing orange heart (🧡) footer"
        ((WARNINGS++))
    fi
    
    # Check for VGP attribution
    if grep -qi 'very good plugins' "$REPO_ROOT/README.md"; then
        echo "✅ README has VGP attribution"
    else
        echo "⚠️  README missing VGP attribution"
        ((WARNINGS++))
    fi
fi

echo ""
echo "🔗 Checking UTM links in README..."
echo "-----------------------------------"

if [[ -f "$REPO_ROOT/README.md" ]]; then
    # Check for external links without UTM
    if grep -E 'https://(verygoodplugins|wpfusion|automem)\.com[^?]' "$REPO_ROOT/README.md" > /dev/null 2>&1; then
        echo "⚠️  Found links without UTM tracking"
        grep -E 'https://(verygoodplugins|wpfusion|automem)\.com[^?]' "$REPO_ROOT/README.md" | head -3
        ((WARNINGS++))
    else
        echo "✅ All external links have UTM (or none found)"
    fi
fi

echo ""
echo "🔒 Security checks..."
echo "----------------------"

# Check for potential secrets
if [[ -d "$PACKAGE_ROOT/src" ]]; then
    if grep -rE '(api_key|apikey|password|secret|token)\s*[:=]\s*["\x27][^"\x27]{8,}["\x27]' "$PACKAGE_ROOT/src" 2>/dev/null | grep -v '.env' > /dev/null; then
        echo "⚠️  Potential hardcoded secrets found"
        ((WARNINGS++))
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
    ((WARNINGS++))
fi

# Check CodeQL action version (v4 required, v3 deprecated Dec 2026)
if [[ -f "$REPO_ROOT/.github/workflows/security.yml" ]]; then
    if grep -q 'codeql-action/.*@v3' "$REPO_ROOT/.github/workflows/security.yml"; then
        echo "⚠️  CodeQL Action v3 deprecated (update to v4)"
        ((WARNINGS++))
    elif grep -q 'codeql-action/.*@v4' "$REPO_ROOT/.github/workflows/security.yml"; then
        echo "✅ CodeQL Action v4 (current)"
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
        ((WARNINGS++))
    fi
    
    # Check for user_config
    if grep -q '"user_config"' "$REPO_ROOT/manifest.json"; then
        echo "✅ user_config defined"
    else
        echo "⚠️  user_config missing (needed for configuration UI)"
        ((WARNINGS++))
    fi
    
    # Check if build script exists
    if [[ "$SERVER_TYPE" == "typescript" ]] && grep -q '"build:extension"' "$PACKAGE_ROOT/package.json"; then
        echo "✅ build:extension script exists"
    elif [[ "$SERVER_TYPE" == "typescript" ]]; then
        echo "⚠️  build:extension script missing (add to package.json)"
        ((WARNINGS++))
    fi
    
    # Check for .mcpbignore
    if [[ -f "$REPO_ROOT/.mcpbignore" ]]; then
        echo "✅ .mcpbignore exists (reduces bundle size)"
    else
        echo "⚠️  .mcpbignore missing (extension bundle may be large)"
        ((WARNINGS++))
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
