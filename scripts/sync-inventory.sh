#!/bin/bash
# Sync server-inventory.json with actual MCP servers
# Usage: ./sync-inventory.sh [--dry-run]
#
# Scans sibling directories for MCP servers and updates the inventory.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ECOSYSTEM_DIR="$SCRIPT_DIR/.."
SERVERS_DIR="$(cd "$ECOSYSTEM_DIR/.." && pwd)"
INVENTORY_FILE="$ECOSYSTEM_DIR/server-inventory.json"

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
    DRY_RUN=true
fi

echo "🔍 Scanning for MCP servers in: $SERVERS_DIR"
echo "================================================"

# Temporary file for building new inventory
TEMP_FILE=$(mktemp)

# Start JSON structure
cat > "$TEMP_FILE" << 'EOF'
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "description": "Inventory of Very Good Plugins MCP servers",
  "lastUpdated": "DATE_PLACEHOLDER",
  "servers": [
EOF

FIRST=true
FOUND_SERVERS=0

# Scan directories
for dir in "$SERVERS_DIR"/mcp-* "$SERVERS_DIR"/*-mcp; do
    if [[ ! -d "$dir" ]]; then
        continue
    fi
    
    # Skip mcp-ecosystem itself
    if [[ "$(basename "$dir")" == "mcp-ecosystem" ]]; then
        continue
    fi
    
    SERVER_NAME=$(basename "$dir")
    
    # Detect type and extract info
    if [[ -f "$dir/package.json" ]]; then
        TYPE="typescript"
        
        # Check if it's actually JavaScript (no tsconfig)
        if [[ ! -f "$dir/tsconfig.json" ]]; then
            TYPE="javascript"
        fi
        
        # Extract info from package.json
        DESCRIPTION=$(grep -o '"description":\s*"[^"]*"' "$dir/package.json" 2>/dev/null | head -1 | sed 's/"description":\s*"//' | sed 's/"$//' || echo "")
        NPM_NAME=$(grep -o '"name":\s*"[^"]*"' "$dir/package.json" 2>/dev/null | head -1 | sed 's/"name":\s*"//' | sed 's/"$//' || echo "")
        MCP_NAME=$(grep -o '"mcpName":\s*"[^"]*"' "$dir/package.json" 2>/dev/null | head -1 | sed 's/"mcpName":\s*"//' | sed 's/"$//' || echo "null")
        
        # Check for published status
        if [[ -n "$NPM_NAME" ]]; then
            STATUS="published"
        else
            STATUS="development"
        fi
        
    elif [[ -f "$dir/pyproject.toml" ]]; then
        TYPE="python"
        
        # Extract info from pyproject.toml
        DESCRIPTION=$(grep -o '^description\s*=\s*"[^"]*"' "$dir/pyproject.toml" 2>/dev/null | head -1 | sed 's/description\s*=\s*"//' | sed 's/"$//' || echo "")
        NPM_NAME="null"
        MCP_NAME=$(grep -o 'name\s*=\s*"io\.github[^"]*"' "$dir/pyproject.toml" 2>/dev/null | head -1 | sed 's/name\s*=\s*"//' | sed 's/"$//' || echo "null")
        PYPI_NAME=$(grep -o '^name\s*=\s*"[^"]*"' "$dir/pyproject.toml" 2>/dev/null | head -1 | sed 's/name\s*=\s*"//' | sed 's/"$//' || echo "")
        
        STATUS="development"
        if [[ -n "$PYPI_NAME" ]]; then
            STATUS="published"
        fi
    else
        # Not an MCP server
        continue
    fi
    
    ((FOUND_SERVERS++))
    
    # Check CI/CD status
    CICD="false"
    if [[ -f "$dir/.github/workflows/ci.yml" ]]; then
        CICD="true"
    fi
    
    # Check tests
    TESTS="false"
    if [[ -d "$dir/tests" ]] || grep -q '"test"' "$dir/package.json" 2>/dev/null; then
        TESTS="true"
    fi
    
    # Check security scanning
    SECURITY="false"
    if [[ -f "$dir/.github/workflows/security.yml" ]]; then
        SECURITY="true"
    fi
    
    # Check desktop extension
    DESKTOP="false"
    if [[ -f "$dir/manifest.json" ]]; then
        DESKTOP="true"
    fi
    
    # Build GitHub URL
    GITHUB_URL="https://github.com/verygoodplugins/$SERVER_NAME"
    
    # Add comma if not first
    if [[ "$FIRST" != true ]]; then
        echo "," >> "$TEMP_FILE"
    fi
    FIRST=false
    
    # Escape description for JSON
    DESCRIPTION_ESCAPED=$(echo "$DESCRIPTION" | sed 's/"/\\"/g')
    
    # Build server entry
    if [[ "$TYPE" == "python" ]]; then
        cat >> "$TEMP_FILE" << EOF
    {
      "name": "$SERVER_NAME",
      "type": "$TYPE",
      "description": "$DESCRIPTION_ESCAPED",
      "github": "$GITHUB_URL",
      "pypi": ${PYPI_NAME:+\"$PYPI_NAME\"}${PYPI_NAME:-null},
      "mcpRegistry": ${MCP_NAME:+\"$MCP_NAME\"}${MCP_NAME:-null},
      "status": "$STATUS",
      "cicd": $CICD,
      "tests": $TESTS,
      "securityScanning": $SECURITY,
      "desktopExtension": $DESKTOP
    }
EOF
    else
        cat >> "$TEMP_FILE" << EOF
    {
      "name": "$SERVER_NAME",
      "type": "$TYPE",
      "description": "$DESCRIPTION_ESCAPED",
      "github": "$GITHUB_URL",
      "npm": ${NPM_NAME:+\"$NPM_NAME\"}${NPM_NAME:-null},
      "mcpRegistry": ${MCP_NAME:+\"$MCP_NAME\"}${MCP_NAME:-null},
      "status": "$STATUS",
      "cicd": $CICD,
      "tests": $TESTS,
      "securityScanning": $SECURITY,
      "desktopExtension": $DESKTOP
    }
EOF
    fi
    
    echo "✅ Found: $SERVER_NAME ($TYPE)"
done

# Close JSON structure
cat >> "$TEMP_FILE" << 'EOF'

  ]
}
EOF

# Replace date placeholder
TODAY=$(date +%Y-%m-%d)
sed -i.bak "s/DATE_PLACEHOLDER/$TODAY/" "$TEMP_FILE"
rm -f "$TEMP_FILE.bak"

echo ""
echo "================================================"
echo "📊 Summary"
echo "================================================"
echo "Found $FOUND_SERVERS MCP servers"
echo ""

if [[ "$DRY_RUN" == true ]]; then
    echo "🔍 DRY RUN - Would update inventory with:"
    echo ""
    cat "$TEMP_FILE"
    rm "$TEMP_FILE"
else
    # Pretty print JSON if jq is available
    if command -v jq &> /dev/null; then
        jq '.' "$TEMP_FILE" > "$INVENTORY_FILE"
        rm "$TEMP_FILE"
    else
        mv "$TEMP_FILE" "$INVENTORY_FILE"
    fi
    echo "✅ Updated: $INVENTORY_FILE"
fi

echo ""
