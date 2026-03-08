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
    
    # Check server.json schema version (must be 2025-12-11)
    if grep -q '2025-12-11' "$SERVER_PATH/server.json"; then
        echo "✅ server.json uses 2025-12-11 schema"
    else
        echo "❌ server.json must use 2025-12-11 schema"
        ((ERRORS++))
    fi
    
    # Check repository.source field
    if grep -q '"source":\s*"github"' "$SERVER_PATH/server.json"; then
        echo "✅ server.json has repository.source: \"github\""
    elif grep -q '"source"' "$SERVER_PATH/server.json"; then
        echo "⚠️  server.json repository.source should be \"github\""
        ((WARNINGS++))
    fi
    
    # Check transport is object format
    if grep -q '"transport":\s*{\s*"type"' "$SERVER_PATH/server.json"; then
        echo "✅ server.json has correct transport format"
    elif grep -q '"transport"' "$SERVER_PATH/server.json"; then
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
WORKFLOWS=("ci.yml" "security.yml" "pr-title.yml")
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
    
    # Check files array exists
    if grep -q '"files"' "$SERVER_PATH/package.json"; then
        echo "✅ files array configured"
    else
        echo "⚠️  files array missing (controls what's published to npm)"
        ((WARNINGS++))
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
    
    # Check MCP SDK version
    if grep -q '@modelcontextprotocol/sdk' "$SERVER_PATH/package.json"; then
        SDK_VERSION=$(grep -o '"@modelcontextprotocol/sdk":\s*"[^"]*"' "$SERVER_PATH/package.json" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' | head -1)
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
    
    # Check ruff configuration
    if grep -q '\[tool.ruff\]' "$SERVER_PATH/pyproject.toml"; then
        echo "✅ ruff configured"
    else
        echo "⚠️  ruff configuration missing"
        ((WARNINGS++))
    fi
    
    # Check Python version requirement
    if grep -q 'requires-python\s*=\s*">=3.11"' "$SERVER_PATH/pyproject.toml"; then
        echo "✅ requires-python >= 3.11"
    elif grep -q 'requires-python' "$SERVER_PATH/pyproject.toml"; then
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
    if [[ -f "$SERVER_PATH/tsconfig.json" ]]; then
        echo "✅ tsconfig.json exists"
        
        # Check for strict mode
        if grep -q '"strict":\s*true' "$SERVER_PATH/tsconfig.json"; then
            echo "✅ tsconfig.json has strict: true"
        else
            echo "⚠️  tsconfig.json should have strict: true"
            ((WARNINGS++))
        fi
        
        # Check for ES2022 target
        if grep -q '"target":\s*"ES2022"' "$SERVER_PATH/tsconfig.json"; then
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
    if [[ -f "$SERVER_PATH/eslint.config.mjs" ]]; then
        echo "✅ eslint.config.mjs exists (flat config)"
    elif [[ -f "$SERVER_PATH/eslint.config.js" ]]; then
        echo "✅ eslint.config.js exists (flat config)"
    elif [[ -f "$SERVER_PATH/.eslintrc.json" || -f "$SERVER_PATH/.eslintrc.js" || -f "$SERVER_PATH/.eslintrc" ]]; then
        echo "⚠️  Legacy ESLint config found (migrate to flat config eslint.config.mjs)"
        ((WARNINGS++))
    else
        echo "⚠️  No ESLint config found"
        ((WARNINGS++))
    fi
    
    # Check Prettier config
    if [[ -f "$SERVER_PATH/.prettierrc" || -f "$SERVER_PATH/.prettierrc.json" || -f "$SERVER_PATH/prettier.config.js" ]]; then
        echo "✅ Prettier config exists"
    else
        echo "⚠️  No Prettier config found"
        ((WARNINGS++))
    fi
    
    # Check vitest config
    if [[ -f "$SERVER_PATH/vitest.config.ts" || -f "$SERVER_PATH/vitest.config.js" ]]; then
        echo "✅ Vitest config exists"
    else
        echo "⚠️  No Vitest config found (tests may use defaults)"
        ((WARNINGS++))
    fi
fi

echo ""
echo "🧵 StdIO stream checks..."
echo "--------------------------"

if [[ -d "$SERVER_PATH/src" ]]; then
    if [[ "$SERVER_TYPE" == "typescript" ]]; then
        # StdIO protocol runs over stdout. Any extra stdout output corrupts MCP.
        if grep -rE 'console\.(log|info|debug)\s*\(' "$SERVER_PATH/src" > /dev/null 2>&1; then
            echo "❌ Found console.log/info/debug in src/ (writes to stdout and can break MCP stdio)"
            grep -rEn 'console\.(log|info|debug)\s*\(' "$SERVER_PATH/src" | head -5
            ((ERRORS++))
        else
            echo "✅ No console.log/info/debug in src/"
        fi

        if grep -rE 'process\.stdout\.write\s*\(' "$SERVER_PATH/src" > /dev/null 2>&1; then
            echo "❌ Found process.stdout.write in src/ (can break MCP stdio)"
            grep -rEn 'process\.stdout\.write\s*\(' "$SERVER_PATH/src" | head -5
            ((ERRORS++))
        else
            echo "✅ No process.stdout.write in src/"
        fi

        if grep -rE "from 'dotenv'|require\\(['\"]dotenv['\"]\\)" "$SERVER_PATH/src" > /dev/null 2>&1; then
            if grep -rE 'config\\(\\)\\s*;\\s*$' "$SERVER_PATH/src" > /dev/null 2>&1; then
                echo "⚠️  dotenv config() called without { quiet: true } (dotenv@17 may log to stdout)"
                grep -rEn 'config\\(\\)\\s*;\\s*$' "$SERVER_PATH/src" | head -5
                ((WARNINGS++))
            else
                echo "✅ dotenv usage does not include bare config()"
            fi
        fi
    else
        # Python: avoid print() to stdout when using stdio_server transport.
        if grep -rE '\\bprint\\s*\\(' "$SERVER_PATH/src" > /dev/null 2>&1; then
            echo "❌ Found print() in src/ (stdout is reserved for MCP stdio)"
            grep -rEn '\\bprint\\s*\\(' "$SERVER_PATH/src" | head -5
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

if [[ -f "$SERVER_PATH/README.md" ]]; then
    # Check for Support section
    if grep -qi '^##.*support' "$SERVER_PATH/README.md"; then
        echo "✅ README has Support section"
    else
        echo "⚠️  README missing Support section"
        ((WARNINGS++))
    fi
    
    # Check for orange heart footer
    if grep -q '🧡' "$SERVER_PATH/README.md"; then
        echo "✅ README has orange heart footer"
    else
        echo "⚠️  README missing orange heart (🧡) footer"
        ((WARNINGS++))
    fi
    
    # Check for VGP attribution
    if grep -qi 'very good plugins' "$SERVER_PATH/README.md"; then
        echo "✅ README has VGP attribution"
    else
        echo "⚠️  README missing VGP attribution"
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
if [[ -d "$SERVER_PATH/src" ]]; then
    if grep -rE '(api_key|apikey|password|secret|token)\s*[:=]\s*["\x27][^"\x27]{8,}["\x27]' "$SERVER_PATH/src" 2>/dev/null | grep -v '.env' > /dev/null; then
        echo "⚠️  Potential hardcoded secrets found"
        ((WARNINGS++))
    else
        echo "✅ No obvious hardcoded secrets"
    fi
else
    echo "ℹ️  No src/ directory to check for secrets"
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
echo "📦 Desktop Extension (optional)..."
echo "-----------------------------------"

# Check for Desktop Extension manifest (optional)
if [[ -f "$SERVER_PATH/manifest.json" ]]; then
    echo "✅ Desktop Extension manifest exists"
    
    # Check manifest_version
    if grep -q '"manifest_version":\s*"0.2"' "$SERVER_PATH/manifest.json"; then
        echo "✅ manifest_version is 0.2"
    elif grep -q '"manifest_version"' "$SERVER_PATH/manifest.json"; then
        echo "⚠️  manifest_version should be \"0.2\""
        ((WARNINGS++))
    fi
    
    # Check for user_config
    if grep -q '"user_config"' "$SERVER_PATH/manifest.json"; then
        echo "✅ user_config defined"
    else
        echo "⚠️  user_config missing (needed for configuration UI)"
        ((WARNINGS++))
    fi
    
    # Check if build script exists
    if [[ "$SERVER_TYPE" == "typescript" ]] && grep -q '"build:extension"' "$SERVER_PATH/package.json"; then
        echo "✅ build:extension script exists"
    elif [[ "$SERVER_TYPE" == "typescript" ]]; then
        echo "⚠️  build:extension script missing (add to package.json)"
        ((WARNINGS++))
    fi
    
    # Check for .mcpbignore
    if [[ -f "$SERVER_PATH/.mcpbignore" ]]; then
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
