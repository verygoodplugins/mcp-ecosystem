#!/bin/bash
# Audit an MCP server against VGP standards
# Usage: ./audit-server.sh <path-to-server>

set -e

SERVER_PATH="${1:-.}"
ERRORS=0
WARNINGS=0

echo "🔍 Auditing MCP server at: $SERVER_PATH"
echo "================================================"

# Detect server type
if [[ -f "$SERVER_PATH/package.json" ]]; then
    SERVER_TYPE="typescript"
    echo "📦 Detected: TypeScript/Node.js server"
elif [[ -f "$SERVER_PATH/pyproject.toml" ]]; then
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
    if [[ -f "$SERVER_PATH/$file" ]]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
        ((ERRORS++))
    fi
done

# Check CLAUDE.md (recommended)
if [[ -f "$SERVER_PATH/CLAUDE.md" ]]; then
    echo "✅ CLAUDE.md exists"
else
    echo "⚠️  CLAUDE.md missing (recommended)"
    ((WARNINGS++))
fi

# Check server.json (MCP Registry)
if [[ -f "$SERVER_PATH/server.json" ]]; then
    echo "✅ server.json exists (MCP Registry)"
else
    echo "⚠️  server.json missing (needed for MCP Registry)"
    ((WARNINGS++))
fi

echo ""
echo "🔧 Checking CI/CD configuration..."
echo "-----------------------------------"

# Check GitHub workflows
WORKFLOWS=("ci.yml" "security.yml")
if [[ "$SERVER_TYPE" == "typescript" ]]; then
    WORKFLOWS+=("release-please.yml")
else
    WORKFLOWS+=("release.yml")
fi

for workflow in "${WORKFLOWS[@]}"; do
    if [[ -f "$SERVER_PATH/.github/workflows/$workflow" ]]; then
        echo "✅ .github/workflows/$workflow exists"
    else
        echo "❌ .github/workflows/$workflow missing"
        ((ERRORS++))
    fi
done

# Check dependabot
if [[ -f "$SERVER_PATH/.github/dependabot.yml" ]]; then
    echo "✅ .github/dependabot.yml exists"
else
    echo "⚠️  .github/dependabot.yml missing"
    ((WARNINGS++))
fi

echo ""
echo "📦 Checking package configuration..."
echo "-------------------------------------"

if [[ "$SERVER_TYPE" == "typescript" ]]; then
    # Check package.json fields
    if grep -q '"mcpName"' "$SERVER_PATH/package.json"; then
        echo "✅ mcpName configured"
    else
        echo "❌ mcpName missing in package.json"
        ((ERRORS++))
    fi

    if grep -q '"publishConfig"' "$SERVER_PATH/package.json"; then
        echo "✅ publishConfig exists"
    else
        echo "⚠️  publishConfig missing"
        ((WARNINGS++))
    fi

    if grep -q '"test"' "$SERVER_PATH/package.json"; then
        echo "✅ test script exists"
    else
        echo "❌ test script missing"
        ((ERRORS++))
    fi

    # Check package-lock.json exists and is not gitignored (required for npm ci)
    if [[ -f "$SERVER_PATH/package-lock.json" ]]; then
        if [[ -f "$SERVER_PATH/.gitignore" ]] && grep -q '^package-lock.json$' "$SERVER_PATH/.gitignore"; then
            echo "❌ package-lock.json is gitignored (CI will fail)"
            ((ERRORS++))
        else
            echo "✅ package-lock.json exists and tracked"
        fi
    else
        echo "❌ package-lock.json missing (required for npm ci)"
        ((ERRORS++))
    fi
else
    # Check pyproject.toml fields
    if grep -q '\[tool.mcp\]' "$SERVER_PATH/pyproject.toml"; then
        echo "✅ [tool.mcp] configured"
    else
        echo "❌ [tool.mcp] missing in pyproject.toml"
        ((ERRORS++))
    fi

    if grep -q '\[tool.pytest' "$SERVER_PATH/pyproject.toml"; then
        echo "✅ pytest configured"
    else
        echo "⚠️  pytest configuration missing"
        ((WARNINGS++))
    fi
fi

echo ""
echo "🔗 Checking UTM links in README..."
echo "-----------------------------------"

if [[ -f "$SERVER_PATH/README.md" ]]; then
    # Check for external links without UTM
    if grep -E 'https://(verygoodplugins|wpfusion|automem)\.com[^?]' "$SERVER_PATH/README.md" > /dev/null 2>&1; then
        echo "⚠️  Found links without UTM tracking"
        grep -E 'https://(verygoodplugins|wpfusion|automem)\.com[^?]' "$SERVER_PATH/README.md" | head -3
        ((WARNINGS++))
    else
        echo "✅ All external links have UTM (or none found)"
    fi
fi

echo ""
echo "🔒 Security checks..."
echo "----------------------"

# Check for potential secrets
if grep -rE '(api_key|apikey|password|secret|token)\s*[:=]\s*["\x27][^"\x27]{8,}["\x27]' "$SERVER_PATH/src" 2>/dev/null | grep -v '.env' > /dev/null; then
    echo "⚠️  Potential hardcoded secrets found"
    ((WARNINGS++))
else
    echo "✅ No obvious hardcoded secrets"
fi

# Check for .env in git
if [[ -f "$SERVER_PATH/.gitignore" ]] && grep -q '.env' "$SERVER_PATH/.gitignore"; then
    echo "✅ .env in .gitignore"
else
    echo "⚠️  .env may not be in .gitignore"
    ((WARNINGS++))
fi

# Check CodeQL action version (v4 required, v3 deprecated Dec 2026)
if [[ -f "$SERVER_PATH/.github/workflows/security.yml" ]]; then
    if grep -q 'codeql-action/.*@v3' "$SERVER_PATH/.github/workflows/security.yml"; then
        echo "⚠️  CodeQL Action v3 deprecated (update to v4)"
        ((WARNINGS++))
    elif grep -q 'codeql-action/.*@v4' "$SERVER_PATH/.github/workflows/security.yml"; then
        echo "✅ CodeQL Action v4 (current)"
    fi
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
