#!/bin/bash
# Apply VGP MCP templates to a server
# Usage: ./apply-templates.sh <typescript|python> <path-to-server> [--force]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/../templates"

# Parse arguments
FORCE=false
SERVER_TYPE=""
SERVER_PATH=""

for arg in "$@"; do
    case $arg in
        --force|-f)
            FORCE=true
            ;;
        typescript|python)
            SERVER_TYPE="$arg"
            ;;
        *)
            if [[ -z "$SERVER_PATH" && "$arg" != --* ]]; then
                SERVER_PATH="$arg"
            fi
            ;;
    esac
done

# Defaults
SERVER_TYPE="${SERVER_TYPE:-typescript}"
SERVER_PATH="${SERVER_PATH:-.}"

usage() {
    echo "Usage: $0 <typescript|python> <path-to-server> [--force]"
    echo ""
    echo "Arguments:"
    echo "  type        Server type: 'typescript' or 'python'"
    echo "  path        Path to the server directory"
    echo "  --force     Overwrite existing files instead of skipping"
    echo ""
    echo "Examples:"
    echo "  $0 typescript ../mcp-freescout"
    echo "  $0 python ../mcp-weather --force"
    exit 1
}

if [[ ! -d "$SERVER_PATH" ]]; then
    echo "❌ Server path does not exist: $SERVER_PATH"
    exit 1
fi

if [[ "$SERVER_TYPE" != "typescript" && "$SERVER_TYPE" != "python" ]]; then
    echo "❌ Invalid server type: $SERVER_TYPE (must be 'typescript' or 'python')"
    usage
fi

if [[ "$FORCE" == true ]]; then
    echo "🚀 Applying $SERVER_TYPE templates to: $SERVER_PATH (FORCE MODE)"
else
    echo "🚀 Applying $SERVER_TYPE templates to: $SERVER_PATH"
fi
echo "================================================"

# Create .github directory if needed
mkdir -p "$SERVER_PATH/.github/workflows"

# Helper function to copy files
copy_file() {
    local src="$1"
    local dest="$2"
    local name="$3"
    
    if [[ -f "$dest" && "$FORCE" != true ]]; then
        echo "⚠️  Skipping $name (already exists, use --force to overwrite)"
    else
        cp "$src" "$dest"
        if [[ -f "$dest" && "$FORCE" == true ]]; then
            echo "🔄 Updated $name"
        else
            echo "✅ Created $name"
        fi
    fi
}

# Copy workflow files
echo ""
echo "📋 Copying workflow files..."
for file in "$TEMPLATE_DIR/$SERVER_TYPE/.github/workflows"/*.yml; do
    filename=$(basename "$file")
    copy_file "$file" "$SERVER_PATH/.github/workflows/$filename" ".github/workflows/$filename"
done

# Copy dependabot config
copy_file "$TEMPLATE_DIR/$SERVER_TYPE/.github/dependabot.yml" "$SERVER_PATH/.github/dependabot.yml" ".github/dependabot.yml"

# Copy GitHub hygiene files (CODEOWNERS, SECURITY.md, PR + issue templates)
echo ""
echo "🧰 Copying GitHub hygiene files..."
mkdir -p "$SERVER_PATH/.github/ISSUE_TEMPLATE"
HYGIENE_FILES=(
    ".github/CODEOWNERS"
    ".github/SECURITY.md"
    ".github/PULL_REQUEST_TEMPLATE.md"
    ".github/ISSUE_TEMPLATE/config.yml"
    ".github/ISSUE_TEMPLATE/bug_report.yml"
    ".github/ISSUE_TEMPLATE/feature_request.yml"
)
for relpath in "${HYGIENE_FILES[@]}"; do
    src="$TEMPLATE_DIR/$SERVER_TYPE/$relpath"
    if [[ -f "$src" ]]; then
        copy_file "$src" "$SERVER_PATH/$relpath" "$relpath"
    fi
done

# Copy config files
echo ""
echo "⚙️  Copying config files..."

if [[ "$SERVER_TYPE" == "typescript" ]]; then
    # ESLint config
    if [[ -f "$TEMPLATE_DIR/typescript/eslint.config.mjs" ]]; then
        copy_file "$TEMPLATE_DIR/typescript/eslint.config.mjs" "$SERVER_PATH/eslint.config.mjs" "eslint.config.mjs"
    fi
    
    # Prettier config
    if [[ -f "$TEMPLATE_DIR/typescript/.prettierrc" ]]; then
        copy_file "$TEMPLATE_DIR/typescript/.prettierrc" "$SERVER_PATH/.prettierrc" ".prettierrc"
    fi
    
    # Vitest config
    if [[ -f "$TEMPLATE_DIR/typescript/vitest.config.ts" ]]; then
        copy_file "$TEMPLATE_DIR/typescript/vitest.config.ts" "$SERVER_PATH/vitest.config.ts" "vitest.config.ts"
    fi
    
    # tsconfig.json (only if missing - don't overwrite customizations)
    if [[ ! -f "$SERVER_PATH/tsconfig.json" ]]; then
        if [[ -f "$TEMPLATE_DIR/typescript/tsconfig.json" ]]; then
            copy_file "$TEMPLATE_DIR/typescript/tsconfig.json" "$SERVER_PATH/tsconfig.json" "tsconfig.json"
        fi
    else
        echo "⚠️  Skipping tsconfig.json (project-specific, not overwritten)"
    fi
    
    # .gitignore (only if missing)
    if [[ ! -f "$SERVER_PATH/.gitignore" ]]; then
        if [[ -f "$TEMPLATE_DIR/typescript/.gitignore" ]]; then
            copy_file "$TEMPLATE_DIR/typescript/.gitignore" "$SERVER_PATH/.gitignore" ".gitignore"
        fi
    else
        echo "⚠️  Skipping .gitignore (already exists)"
    fi
else
    # Python .gitignore (only if missing)
    if [[ ! -f "$SERVER_PATH/.gitignore" ]]; then
        if [[ -f "$TEMPLATE_DIR/python/.gitignore" ]]; then
            copy_file "$TEMPLATE_DIR/python/.gitignore" "$SERVER_PATH/.gitignore" ".gitignore"
        fi
    else
        echo "⚠️  Skipping .gitignore (already exists)"
    fi
fi

echo ""
echo "📝 Files that may need manual updates:"
echo "---------------------------------------"

if [[ "$SERVER_TYPE" == "typescript" ]]; then
    echo "• package.json: Add 'mcpName' field"
    echo "• package.json: Ensure 'publishConfig.access' is 'public'"
    echo "• package.json: Ensure 'files' array is configured"
    echo "• package.json: Ensure test script exists"
    echo "• Create server.json for MCP Registry (use 2025-12-11 schema)"
else
    echo "• pyproject.toml: Add [tool.mcp] section with 'name'"
    echo "• pyproject.toml: Add [tool.ruff] configuration"
    echo "• pyproject.toml: Ensure pytest configuration exists"
    echo "• Create server.json for MCP Registry (use 2025-12-11 schema)"
fi

echo ""
echo "🔗 Next steps:"
echo "--------------"
echo "1. Update package configuration with mcpName"
echo "2. Create server.json for MCP Registry"
echo "3. Configure Trusted Publishing on npm/PyPI"
echo "4. Run: ./audit-server.sh $SERVER_PATH"
echo ""
echo "✅ Templates applied successfully!"
