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
        echo "ℹ️  Skipping tsconfig.json (project-specific, not overwritten)"
    fi
    
    # .gitignore (only if missing)
    if [[ ! -f "$SERVER_PATH/.gitignore" ]]; then
        if [[ -f "$TEMPLATE_DIR/typescript/.gitignore" ]]; then
            copy_file "$TEMPLATE_DIR/typescript/.gitignore" "$SERVER_PATH/.gitignore" ".gitignore"
        fi
    else
        echo "ℹ️  Skipping .gitignore (already exists)"
    fi
else
    # Python .gitignore (only if missing)
    if [[ ! -f "$SERVER_PATH/.gitignore" ]]; then
        if [[ -f "$TEMPLATE_DIR/python/.gitignore" ]]; then
            copy_file "$TEMPLATE_DIR/python/.gitignore" "$SERVER_PATH/.gitignore" ".gitignore"
        fi
    else
        echo "ℹ️  Skipping .gitignore (already exists)"
    fi
fi

if command -v node >/dev/null 2>&1; then
    node "$SCRIPT_DIR/lib/print-apply-templates-followups.mjs" "$SERVER_PATH" "$SERVER_TYPE"
else
    echo ""
    echo "ℹ️  node not found; skipping manifest follow-up checks. Run ./scripts/audit-server.sh $SERVER_PATH"
fi

echo ""
echo "✅ Templates applied successfully!"
