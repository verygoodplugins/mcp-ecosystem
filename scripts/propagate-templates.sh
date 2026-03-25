#!/usr/bin/env bash
# Propagate source-of-truth templates from mcp-ecosystem to downstream MCP servers.
# Usage: ./propagate-templates.sh [--server <name>] [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INVENTORY_FILE="$ROOT_DIR/server-inventory.json"
DRY_RUN=false
SERVER_FILTER=""
BASE_BRANCH="main"
SYNC_BRANCH="chore/template-sync"

usage() {
    echo "Usage: $0 [--server <name>] [--dry-run]"
    echo ""
    echo "Options:"
    echo "  --server <name>  Sync only one server from server-inventory.json"
    echo "  --dry-run        Preview changes without pushing branches or opening PRs"
    exit 1
}

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "❌ Required command not found: $1"
        exit 1
    fi
}

normalize_server_type() {
    case "$1" in
        typescript|javascript)
            echo "typescript"
            ;;
        python)
            echo "python"
            ;;
        *)
            return 1
            ;;
    esac
}

repo_slug_from_url() {
    echo "$1" | sed -E 's#https://github.com/##; s#/$##'
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server)
            [[ $# -lt 2 ]] && usage
            SERVER_FILTER="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            usage
            ;;
    esac
done

require_command git
require_command gh
require_command jq
require_command node
require_command npm

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

SOURCE_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "working-tree")"
RUN_DATE="$(date +%Y-%m-%d)"

echo "🚀 Propagating mcp-ecosystem templates"
echo "Source SHA: $SOURCE_SHA"
echo "Mode: $([[ "$DRY_RUN" == true ]] && echo "dry-run" || echo "open-prs")"
echo ""

mapfile -t SERVERS < <(jq -c '.servers[]' "$INVENTORY_FILE")
MATCHED_SERVER=false

for SERVER_JSON in "${SERVERS[@]}"; do
    SERVER_NAME="$(jq -r '.name' <<<"$SERVER_JSON")"
    if [[ -n "$SERVER_FILTER" && "$SERVER_FILTER" != "$SERVER_NAME" ]]; then
        continue
    fi
    MATCHED_SERVER=true

    SERVER_URL="$(jq -r '.github' <<<"$SERVER_JSON")"
    RAW_SERVER_TYPE="$(jq -r '.type' <<<"$SERVER_JSON")"
    if ! SERVER_TYPE="$(normalize_server_type "$RAW_SERVER_TYPE")"; then
        echo "⚠️  Skipping $SERVER_NAME: unsupported type '$RAW_SERVER_TYPE'"
        continue
    fi

    REPO_SLUG="$(repo_slug_from_url "$SERVER_URL")"
    REPO_DIR="$TEMP_DIR/$SERVER_NAME"

    echo "==> $SERVER_NAME ($SERVER_TYPE)"
    gh repo clone "$REPO_SLUG" "$REPO_DIR" -- --quiet

    git -C "$REPO_DIR" checkout "$BASE_BRANCH" >/dev/null 2>&1
    git -C "$REPO_DIR" pull --ff-only origin "$BASE_BRANCH" >/dev/null 2>&1

    "$SCRIPT_DIR/apply-templates.sh" "$SERVER_TYPE" "$REPO_DIR" --force >/dev/null
    node "$SCRIPT_DIR/sync-template-baseline.mjs" "$SERVER_TYPE" "$REPO_DIR" >/dev/null

    # Regenerate lockfile if package.json changed
    if [[ "$SERVER_TYPE" == "typescript" && -n "$(git -C "$REPO_DIR" diff --name-only -- package.json)" ]]; then
        echo "   Regenerating package-lock.json..."
        (cd "$REPO_DIR" && npm install --package-lock-only --ignore-scripts) >/dev/null
    fi

    if [[ -z "$(git -C "$REPO_DIR" status --short)" ]]; then
        echo "   No template drift"
        echo ""
        continue
    fi

    echo "   Changed files:"
    git -C "$REPO_DIR" status --short | sed 's/^/   - /'

    if [[ "$DRY_RUN" == true ]]; then
        echo ""
        continue
    fi

    git -C "$REPO_DIR" checkout -B "$SYNC_BRANCH" >/dev/null 2>&1
    git -C "$REPO_DIR" add .
    git -C "$REPO_DIR" \
        -c user.name="github-actions[bot]" \
        -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
        commit -m "chore(template): sync from mcp-ecosystem" >/dev/null
    git -C "$REPO_DIR" push --force-with-lease --set-upstream origin "$SYNC_BRANCH" >/dev/null

    EXISTING_PR="$(gh pr list --repo "$REPO_SLUG" --head "$SYNC_BRANCH" --state open --json number --jq '.[0].number // empty')"
    if [[ -n "$EXISTING_PR" ]]; then
        echo "   Updated existing PR #$EXISTING_PR"
        echo ""
        continue
    fi

    gh pr create \
        --repo "$REPO_SLUG" \
        --base "$BASE_BRANCH" \
        --head "$SYNC_BRANCH" \
        --title "chore(template): sync from mcp-ecosystem" \
        --body "$(cat <<EOF
Sync shared workflow/config/template baselines from \`verygoodplugins/mcp-ecosystem\`.

- Source commit: \`$SOURCE_SHA\`
- Sync date: \`$RUN_DATE\`
- Applied workflow and config templates with \`scripts/apply-templates.sh --force\`
- Re-aligned shared dependency baselines with \`scripts/sync-template-baseline.mjs\`

This PR is generated from the ecosystem source of truth to reduce per-repo Dependabot drift.
EOF
)" >/dev/null

    echo "   Opened PR in $REPO_SLUG"
    echo ""
done

if [[ -n "$SERVER_FILTER" && "$MATCHED_SERVER" != true ]]; then
    echo "❌ Unknown server: $SERVER_FILTER"
    exit 1
fi
