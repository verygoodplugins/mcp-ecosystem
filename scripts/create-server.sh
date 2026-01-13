#!/bin/bash
# Create a new MCP server from templates
# Usage: ./create-server.sh <typescript|python> <name> ["description"]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR/../templates"

SERVER_TYPE="${1:-}"
SERVER_NAME="${2:-}"
SERVER_DESC="${3:-MCP server for $SERVER_NAME}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

usage() {
    echo "Usage: $0 <typescript|python> <name> [\"description\"]"
    echo ""
    echo "Arguments:"
    echo "  type        Server type: 'typescript' or 'python'"
    echo "  name        Server name (e.g., 'freescout', 'toggl')"
    echo "  description Optional description (default: 'MCP server for <name>')"
    echo ""
    echo "Examples:"
    echo "  $0 typescript edd \"Easy Digital Downloads REST API integration\""
    echo "  $0 python weather \"Weather forecast and alerts\""
    echo ""
    echo "The server will be created at: ../mcp-<name>"
    exit 1
}

# Validate arguments
if [[ -z "$SERVER_TYPE" || -z "$SERVER_NAME" ]]; then
    usage
fi

if [[ "$SERVER_TYPE" != "typescript" && "$SERVER_TYPE" != "python" ]]; then
    echo -e "${RED}❌ Invalid server type: $SERVER_TYPE (must be 'typescript' or 'python')${NC}"
    exit 1
fi

# Remove 'mcp-' prefix if provided
SERVER_NAME="${SERVER_NAME#mcp-}"

# Create output directory path (sibling to mcp-ecosystem)
OUTPUT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)/mcp-$SERVER_NAME"

if [[ -d "$OUTPUT_DIR" ]]; then
    echo -e "${RED}❌ Directory already exists: $OUTPUT_DIR${NC}"
    exit 1
fi

# Create placeholder values
NAME="$SERVER_NAME"
NAME_UNDERSCORE="${SERVER_NAME//-/_}"  # Replace hyphens with underscores for Python
NAME_CAPITALIZED="$(echo "$SERVER_NAME" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)} 1' | sed 's/ //g')"

echo -e "${BLUE}🚀 Creating MCP server: mcp-$NAME${NC}"
echo "================================================"
echo -e "Type:        ${GREEN}$SERVER_TYPE${NC}"
echo -e "Name:        ${GREEN}mcp-$NAME${NC}"
echo -e "Description: ${GREEN}$SERVER_DESC${NC}"
echo -e "Output:      ${GREEN}$OUTPUT_DIR${NC}"
echo ""

# Create directory structure
echo -e "${YELLOW}📁 Creating directory structure...${NC}"
mkdir -p "$OUTPUT_DIR"

# Copy and process templates
process_template() {
    local src="$1"
    local dest="$2"
    
    # Replace placeholders
    sed -e "s/{name}/$NAME/g" \
        -e "s/{Name}/$NAME_CAPITALIZED/g" \
        -e "s/{name_underscore}/$NAME_UNDERSCORE/g" \
        -e "s/{description}/$SERVER_DESC/g" \
        "$src" > "$dest"
}

copy_file() {
    local src="$1"
    local dest="$2"
    cp "$src" "$dest"
}

if [[ "$SERVER_TYPE" == "typescript" ]]; then
    # TypeScript structure
    mkdir -p "$OUTPUT_DIR/src" "$OUTPUT_DIR/tests" "$OUTPUT_DIR/.github/workflows"
    
    echo -e "${YELLOW}📋 Processing TypeScript templates...${NC}"
    
    # Process template files (with placeholders)
    process_template "$TEMPLATE_DIR/typescript/package.json.template" "$OUTPUT_DIR/package.json"
    process_template "$TEMPLATE_DIR/typescript/src/index.ts.template" "$OUTPUT_DIR/src/index.ts"
    process_template "$TEMPLATE_DIR/typescript/CLAUDE.md.template" "$OUTPUT_DIR/CLAUDE.md"
    process_template "$TEMPLATE_DIR/typescript/README.md.template" "$OUTPUT_DIR/README.md"
    process_template "$TEMPLATE_DIR/typescript/LICENSE.template" "$OUTPUT_DIR/LICENSE"
    process_template "$TEMPLATE_DIR/typescript/server.json.template" "$OUTPUT_DIR/server.json"
    process_template "$TEMPLATE_DIR/typescript/tests/index.test.ts.template" "$OUTPUT_DIR/tests/index.test.ts"
    
    # Copy static files (no placeholders)
    copy_file "$TEMPLATE_DIR/typescript/tsconfig.json" "$OUTPUT_DIR/tsconfig.json"
    copy_file "$TEMPLATE_DIR/typescript/.prettierrc" "$OUTPUT_DIR/.prettierrc"
    copy_file "$TEMPLATE_DIR/typescript/.gitignore" "$OUTPUT_DIR/.gitignore"
    copy_file "$TEMPLATE_DIR/typescript/eslint.config.mjs" "$OUTPUT_DIR/eslint.config.mjs"
    copy_file "$TEMPLATE_DIR/typescript/vitest.config.ts" "$OUTPUT_DIR/vitest.config.ts"
    
    # Copy workflow files
    for file in "$TEMPLATE_DIR/typescript/.github/workflows"/*.yml; do
        copy_file "$file" "$OUTPUT_DIR/.github/workflows/$(basename "$file")"
    done
    copy_file "$TEMPLATE_DIR/typescript/.github/dependabot.yml" "$OUTPUT_DIR/.github/dependabot.yml"
    
    # Create empty CHANGELOG.md
    echo "# Changelog" > "$OUTPUT_DIR/CHANGELOG.md"
    echo "" >> "$OUTPUT_DIR/CHANGELOG.md"
    echo "All notable changes to this project will be documented in this file." >> "$OUTPUT_DIR/CHANGELOG.md"
    
    echo -e "${GREEN}✅ TypeScript templates applied${NC}"
    
else
    # Python structure
    mkdir -p "$OUTPUT_DIR/src/mcp_$NAME_UNDERSCORE" "$OUTPUT_DIR/tests" "$OUTPUT_DIR/.github/workflows"
    
    echo -e "${YELLOW}📋 Processing Python templates...${NC}"
    
    # Process template files (with placeholders)
    process_template "$TEMPLATE_DIR/python/pyproject.toml.template" "$OUTPUT_DIR/pyproject.toml"
    process_template "$TEMPLATE_DIR/python/src/mcp_name/__init__.py.template" "$OUTPUT_DIR/src/mcp_$NAME_UNDERSCORE/__init__.py"
    process_template "$TEMPLATE_DIR/python/src/mcp_name/server.py.template" "$OUTPUT_DIR/src/mcp_$NAME_UNDERSCORE/server.py"
    process_template "$TEMPLATE_DIR/python/CLAUDE.md.template" "$OUTPUT_DIR/CLAUDE.md"
    process_template "$TEMPLATE_DIR/python/README.md.template" "$OUTPUT_DIR/README.md"
    process_template "$TEMPLATE_DIR/python/LICENSE.template" "$OUTPUT_DIR/LICENSE"
    process_template "$TEMPLATE_DIR/python/server.json.template" "$OUTPUT_DIR/server.json"
    process_template "$TEMPLATE_DIR/python/tests/test_server.py.template" "$OUTPUT_DIR/tests/test_server.py"
    
    # Copy static files
    copy_file "$TEMPLATE_DIR/python/.gitignore" "$OUTPUT_DIR/.gitignore"
    
    # Copy workflow files
    for file in "$TEMPLATE_DIR/python/.github/workflows"/*.yml; do
        copy_file "$file" "$OUTPUT_DIR/.github/workflows/$(basename "$file")"
    done
    copy_file "$TEMPLATE_DIR/python/.github/dependabot.yml" "$OUTPUT_DIR/.github/dependabot.yml"
    
    # Create empty CHANGELOG.md
    echo "# Changelog" > "$OUTPUT_DIR/CHANGELOG.md"
    echo "" >> "$OUTPUT_DIR/CHANGELOG.md"
    echo "All notable changes to this project will be documented in this file." >> "$OUTPUT_DIR/CHANGELOG.md"
    
    echo -e "${GREEN}✅ Python templates applied${NC}"
fi

# Initialize git repository
echo ""
echo -e "${YELLOW}🔧 Initializing git repository...${NC}"
cd "$OUTPUT_DIR"
git init -q
git add .
echo -e "${GREEN}✅ Git repository initialized${NC}"

# Install dependencies (optional)
echo ""
echo -e "${YELLOW}📦 Installing dependencies...${NC}"

if [[ "$SERVER_TYPE" == "typescript" ]]; then
    if command -v npm &> /dev/null; then
        npm install --silent 2>/dev/null || echo -e "${YELLOW}⚠️  npm install had warnings (check manually)${NC}"
        echo -e "${GREEN}✅ npm dependencies installed${NC}"
    else
        echo -e "${YELLOW}⚠️  npm not found, skipping dependency install${NC}"
    fi
else
    echo -e "${BLUE}ℹ️  Run 'pip install -e .[dev]' to install Python dependencies${NC}"
fi

# Print summary
echo ""
echo "================================================"
echo -e "${GREEN}🎉 Server created successfully!${NC}"
echo "================================================"
echo ""
echo -e "${BLUE}📍 Location:${NC} $OUTPUT_DIR"
echo ""
echo -e "${YELLOW}📝 Next steps:${NC}"
echo ""
echo "1. cd $OUTPUT_DIR"
echo ""
if [[ "$SERVER_TYPE" == "typescript" ]]; then
    echo "2. Edit src/index.ts to implement your tools"
    echo "3. Update package.json with correct description/keywords"
else
    echo "2. Create venv: python -m venv venv && source venv/bin/activate"
    echo "3. Install: pip install -e \".[dev]\""
    echo "4. Edit src/mcp_$NAME_UNDERSCORE/server.py to implement your tools"
    echo "5. Update pyproject.toml with correct description/keywords"
fi
echo ""
echo "4. Update server.json with your tools list"
echo "5. Update README.md with full documentation"
echo "6. Run tests: npm test / pytest"
echo "7. Commit: git commit -m \"feat: initial mcp-$NAME implementation\""
echo ""
echo -e "${BLUE}📚 Standards:${NC} https://github.com/verygoodplugins/mcp-ecosystem/blob/main/STANDARDS.md"
echo -e "${BLUE}🔍 Audit:${NC}     $SCRIPT_DIR/audit-server.sh $OUTPUT_DIR"
echo ""
