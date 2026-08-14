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
PROFILE_SERVER_NAME=""

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

if command -v node >/dev/null 2>&1; then
    repo_name="$(basename "$(cd "$SERVER_PATH" && pwd)")"
    PROFILE_SERVER_NAME="$(node --input-type=module -e 'const [modulePath, name, type] = process.argv.slice(1); const { getServerConfig, normalizeServerConfig } = await import(modulePath); try { const server = normalizeServerConfig(getServerConfig(name)); if (server.type !== type) process.exit(1); process.stdout.write(server.name); } catch { process.exit(1); }' "file://$SCRIPT_DIR/lib/ecosystem-config.mjs" "$repo_name" "$SERVER_TYPE" 2>/dev/null || true)"
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

escape_sed_replacement() {
    printf '%s' "$1" | sed 's/[\\/&]/\\&/g'
}

render_agents_template() {
    local src="$1"
    local dest="$2"
    local server_name
    local server_description="an MCP (Model Context Protocol) server"

    if [[ -f "$dest" && "$FORCE" != true ]]; then
        echo "⚠️  Skipping AGENTS.md (already exists, use --force to overwrite)"
        return
    fi

    server_name="$(basename "$(cd "$SERVER_PATH" && pwd)")"
    server_name="${server_name#mcp-}"

    if [[ "$SERVER_TYPE" == "typescript" && -f "$SERVER_PATH/package.json" ]] && command -v node >/dev/null 2>&1; then
        server_description="$(node --input-type=module -e 'import fs from "node:fs"; const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(pkg.description ?? ""));' "$SERVER_PATH/package.json" 2>/dev/null || true)"
    elif [[ "$SERVER_TYPE" == "python" && -f "$SERVER_PATH/pyproject.toml" ]]; then
        server_description="$(sed -n 's/^description = "\(.*\)"$/\1/p' "$SERVER_PATH/pyproject.toml" | head -1)"
    fi

    if [[ -z "$server_description" ]]; then
        server_description="an MCP (Model Context Protocol) server"
    fi

    local escaped_name escaped_description escaped_underscore
    escaped_name="$(escape_sed_replacement "$server_name")"
    escaped_description="$(escape_sed_replacement "$server_description")"
    escaped_underscore="$(escape_sed_replacement "${server_name//-/_}")"

    sed \
        -e "s/{name}/$escaped_name/g" \
        -e "s/{name_underscore}/$escaped_underscore/g" \
        -e "s/{description}/$escaped_description/g" \
        "$src" > "$dest"
    echo "✅ Created AGENTS.md"
}

sync_release_please_manifest() {
    local manifest_path="$SERVER_PATH/.release-please-manifest.json"
    local version="1.0.0"

    if [[ -f "$manifest_path" && "$FORCE" != true ]]; then
        echo "⚠️  Skipping .release-please-manifest.json (already exists, use --force to synchronize)"
        return
    fi

    if ! command -v node >/dev/null 2>&1; then
        if [[ -f "$manifest_path" ]]; then
            echo "⚠️  Cannot safely merge .release-please-manifest.json without node; preserving existing file"
            return
        fi
        copy_file "$TEMPLATE_DIR/typescript/.release-please-manifest.json.template" "$manifest_path" ".release-please-manifest.json"
        return
    fi

    if [[ -f "$SERVER_PATH/package.json" ]]; then
        version="$(node --input-type=module -e 'import fs from "node:fs"; const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(pkg.version ?? "1.0.0"));' "$SERVER_PATH/package.json" 2>/dev/null || echo "1.0.0")"
    fi

    node --input-type=module -e 'import fs from "node:fs"; const [manifestPath, version] = process.argv.slice(1); const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {}; manifest["."] = version; fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);' "$manifest_path" "$version"
    echo "✅ Synced .release-please-manifest.json to package.json version $version"
}

render_profile_ci() {
    local destination="$SERVER_PATH/.github/workflows/ci.yml"

    if [[ -z "$PROFILE_SERVER_NAME" ]]; then
        return 1
    fi

    if [[ -f "$destination" && "$FORCE" != true ]]; then
        echo "⚠️  Skipping .github/workflows/ci.yml (profile-managed file already exists, use --force to regenerate)"
        return 0
    fi

    node --input-type=module -e 'import fs from "node:fs"; const [modulePath, serverName, destinationPath] = process.argv.slice(1); const { getServerConfig, normalizeServerConfig, renderManagedFiles, resolveServerProfiles } = await import(modulePath); const server = normalizeServerConfig(getServerConfig(serverName)); const files = renderManagedFiles(server, resolveServerProfiles(server)); fs.writeFileSync(destinationPath, files[".github/workflows/ci.yml"]);' "file://$SCRIPT_DIR/lib/ecosystem-config.mjs" "$PROFILE_SERVER_NAME" "$destination"
    echo "✅ Rendered .github/workflows/ci.yml from $PROFILE_SERVER_NAME profile"
}

# Copy workflow files
echo ""
echo "📋 Copying workflow files..."
for file in "$TEMPLATE_DIR/$SERVER_TYPE/.github/workflows"/*.yml; do
    filename=$(basename "$file")
    if [[ "$filename" == "ci.yml" && -n "$PROFILE_SERVER_NAME" ]]; then
        render_profile_ci
    else
        copy_file "$file" "$SERVER_PATH/.github/workflows/$filename" ".github/workflows/$filename"
    fi
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

render_agents_template "$TEMPLATE_DIR/$SERVER_TYPE/AGENTS.md.template" "$SERVER_PATH/AGENTS.md"

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

    copy_file "$TEMPLATE_DIR/typescript/release-please-config.json.template" "$SERVER_PATH/release-please-config.json" "release-please-config.json"
    sync_release_please_manifest

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
