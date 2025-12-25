#!/bin/bash
# Apply VGP MCP templates to a server
# Usage: ./apply-templates.sh <typescript|python> <path-to-server>

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/../templates"

SERVER_TYPE="${1:-typescript}"
SERVER_PATH="${2:-.}"

if [[ ! -d "$SERVER_PATH" ]]; then
    echo "❌ Server path does not exist: $SERVER_PATH"
    exit 1
fi

if [[ "$SERVER_TYPE" != "typescript" && "$SERVER_TYPE" != "python" ]]; then
    echo "❌ Invalid server type: $SERVER_TYPE (must be 'typescript' or 'python')"
    exit 1
fi

echo "🚀 Applying $SERVER_TYPE templates to: $SERVER_PATH"
echo "================================================"

# Create .github directory if needed
mkdir -p "$SERVER_PATH/.github/workflows"

# Copy workflow files
echo ""
echo "📋 Copying workflow files..."
for file in "$TEMPLATE_DIR/$SERVER_TYPE/.github/workflows"/*.yml; do
    filename=$(basename "$file")
    if [[ -f "$SERVER_PATH/.github/workflows/$filename" ]]; then
        echo "⚠️  Skipping $filename (already exists)"
    else
        cp "$file" "$SERVER_PATH/.github/workflows/"
        echo "✅ Created .github/workflows/$filename"
    fi
done

# Copy dependabot config
if [[ -f "$SERVER_PATH/.github/dependabot.yml" ]]; then
    echo "⚠️  Skipping dependabot.yml (already exists)"
else
    cp "$TEMPLATE_DIR/$SERVER_TYPE/.github/dependabot.yml" "$SERVER_PATH/.github/"
    echo "✅ Created .github/dependabot.yml"
fi

echo ""
echo "📝 Files that may need manual updates:"
echo "---------------------------------------"

if [[ "$SERVER_TYPE" == "typescript" ]]; then
    echo "• package.json: Add 'mcpName' field"
    echo "• package.json: Ensure 'publishConfig.access' is 'public'"
    echo "• package.json: Ensure test script exists"
    echo "• Create server.json for MCP Registry"
else
    echo "• pyproject.toml: Add [tool.mcp] section with 'name'"
    echo "• pyproject.toml: Ensure pytest configuration exists"
    echo "• Create server.json for MCP Registry"
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
