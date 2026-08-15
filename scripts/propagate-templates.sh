#!/usr/bin/env bash
# Propagate source-of-truth templates from mcp-ecosystem to downstream MCP servers.
# Usage: ./propagate-templates.sh [--server <name>] [--dry-run]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INVENTORY_FILE="${INVENTORY_FILE:-$ROOT_DIR/server-inventory.json}"
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

RESULT_NAMES=()
RESULT_STATUSES=()
RESULT_DETAILS=()
HAS_BLOCKED_REPOSITORY=false

record_result() {
    RESULT_NAMES+=("$1")
    RESULT_STATUSES+=("$2")
    RESULT_DETAILS+=("$3")
    if [[ "$2" == "blocked" ]]; then
        HAS_BLOCKED_REPOSITORY=true
    fi
}

print_result_table() {
    echo "Propagation results:"
    printf "%-24s %-16s %s\n" "Repository" "Status" "Details"
    printf "%-24s %-16s %s\n" "----------" "------" "-------"

    for index in "${!RESULT_NAMES[@]}"; do
        printf "%-24s %-16s %s\n" \
            "${RESULT_NAMES[$index]}" \
            "${RESULT_STATUSES[$index]}" \
            "${RESULT_DETAILS[$index]}"
    done
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

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

SOURCE_SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo "working-tree")"
RUN_DATE="$(date +%Y-%m-%d)"

echo "🚀 Propagating mcp-ecosystem templates"
echo "Source SHA: $SOURCE_SHA"
echo "Mode: $([[ "$DRY_RUN" == true ]] && echo "dry-run" || echo "open-prs")"
echo ""

SERVERS=()
while IFS= read -r server_json; do
    SERVERS+=("$server_json")
done < <(jq -c '.servers[]' "$INVENTORY_FILE")
MATCHED_SERVER=false

for SERVER_JSON in "${SERVERS[@]}"; do
    SERVER_NAME="$(jq -r '.name' <<<"$SERVER_JSON")"
    if [[ -n "$SERVER_FILTER" && "$SERVER_FILTER" != "$SERVER_NAME" ]]; then
        continue
    fi
    MATCHED_SERVER=true

    PROPAGATE_ENABLED="$(jq -r 'if has("propagate") then .propagate else true end' <<<"$SERVER_JSON")"
    if [[ "$PROPAGATE_ENABLED" != "true" ]]; then
        echo "==> $SERVER_NAME"
        echo "   Propagation disabled in server-inventory.json"
        echo ""
        continue
    fi

    SERVER_URL="$(jq -r '.github' <<<"$SERVER_JSON")"
    RAW_SERVER_TYPE="$(jq -r '.type' <<<"$SERVER_JSON")"
    if ! SERVER_TYPE="$(normalize_server_type "$RAW_SERVER_TYPE")"; then
        echo "⚠️  Blocking $SERVER_NAME: unsupported type '$RAW_SERVER_TYPE'"
        record_result "$SERVER_NAME" "blocked" "unsupported type: $RAW_SERVER_TYPE"
        continue
    fi

    REPO_SLUG="$(repo_slug_from_url "$SERVER_URL")"
    REPO_DIR="$TEMP_DIR/$SERVER_NAME"
    REPORT_PATH="$TEMP_DIR/${SERVER_NAME}-sync-report.json"

    echo "==> $SERVER_NAME ($SERVER_TYPE)"
    if ! CLONE_OUTPUT="$(gh repo clone "$REPO_SLUG" "$REPO_DIR" -- --quiet 2>&1)"; then
        echo "   Clone failed; skipping PR"
        echo "$CLONE_OUTPUT" | sed 's/^/   ! /'
        echo ""
        record_result "$SERVER_NAME" "blocked" "clone failed"
        continue
    fi

    if ! git -C "$REPO_DIR" checkout "$BASE_BRANCH" >/dev/null 2>&1; then
        echo "   Checkout failed; skipping PR"
        echo ""
        record_result "$SERVER_NAME" "blocked" "checkout failed"
        continue
    fi

    if ! git -C "$REPO_DIR" pull --ff-only origin "$BASE_BRANCH" >/dev/null 2>&1; then
        echo "   Pull failed; skipping PR"
        echo ""
        record_result "$SERVER_NAME" "blocked" "pull failed"
        continue
    fi

    if ! RENDER_OUTPUT="$(node "$SCRIPT_DIR/render-managed-files.mjs" "$SERVER_NAME" "$REPO_DIR" 2>&1)"; then
        echo "   Render failed; skipping PR"
        echo "$RENDER_OUTPUT" | sed 's/^/   ! /'
        echo ""
        record_result "$SERVER_NAME" "blocked" "render failed"
        continue
    fi

    if ! SYNC_OUTPUT="$(node "$SCRIPT_DIR/sync-template-baseline.mjs" "$SERVER_NAME" "$REPO_DIR" --report-file "$REPORT_PATH" 2>&1)"; then
        echo "   Baseline sync failed; skipping PR"
        echo "$SYNC_OUTPUT" | sed 's/^/   ! /'
        echo ""
        record_result "$SERVER_NAME" "blocked" "baseline sync failed"
        continue
    fi

    if ! VALIDATION_OUTPUT="$(node "$SCRIPT_DIR/validate-sync.mjs" "$SERVER_NAME" "$REPO_DIR" --sync-report "$REPORT_PATH" 2>&1)"; then
        echo "   Preflight failed; skipping PR"
        echo "$VALIDATION_OUTPUT" | sed 's/^/   ! /'
        echo ""
        record_result "$SERVER_NAME" "blocked" "preflight failed"
        continue
    fi

    if ! WORKTREE_STATUS="$(git -C "$REPO_DIR" status --short 2>&1)"; then
        echo "   Status check failed; skipping PR"
        echo "$WORKTREE_STATUS" | sed 's/^/   ! /'
        echo ""
        record_result "$SERVER_NAME" "blocked" "status check failed"
        continue
    fi

    if [[ -z "$WORKTREE_STATUS" ]]; then
        echo "   No template drift"
        echo ""
        record_result "$SERVER_NAME" "clean" "no template drift"
        continue
    fi

    echo "   Changed files:"
    echo "$WORKTREE_STATUS" | sed 's/^/   - /'

    if [[ "$DRY_RUN" == true ]]; then
        echo ""
        record_result "$SERVER_NAME" "changes ready" "dry-run"
        continue
    fi

    if ! git -C "$REPO_DIR" checkout -B "$SYNC_BRANCH" >/dev/null 2>&1; then
        echo "   Branch setup failed; skipping PR"
        echo ""
        record_result "$SERVER_NAME" "blocked" "branch setup failed"
        continue
    fi

    if ! git -C "$REPO_DIR" add .; then
        echo "   Staging failed; skipping PR"
        echo ""
        record_result "$SERVER_NAME" "blocked" "staging failed"
        continue
    fi

    if ! git -C "$REPO_DIR" \
        -c user.name="github-actions[bot]" \
        -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
        commit -m "chore(template): sync from mcp-ecosystem" >/dev/null; then
        echo "   Commit failed; skipping PR"
        echo ""
        record_result "$SERVER_NAME" "blocked" "commit failed"
        continue
    fi

    if ! git -C "$REPO_DIR" push --force-with-lease --set-upstream origin "$SYNC_BRANCH" >/dev/null; then
        echo "   Push failed; skipping PR"
        echo ""
        record_result "$SERVER_NAME" "blocked" "push failed"
        continue
    fi

    if ! EXISTING_PR="$(gh pr list --repo "$REPO_SLUG" --head "$SYNC_BRANCH" --state open --json number --jq '.[0].number // empty')"; then
        echo "   PR lookup failed; skipping PR"
        echo ""
        record_result "$SERVER_NAME" "blocked" "PR lookup failed"
        continue
    fi

    if [[ -n "$EXISTING_PR" ]]; then
        echo "   Updated existing PR #$EXISTING_PR"
        echo ""
        record_result "$SERVER_NAME" "PR updated" "#$EXISTING_PR"
        continue
    fi

    if ! gh pr create \
        --repo "$REPO_SLUG" \
        --base "$BASE_BRANCH" \
        --head "$SYNC_BRANCH" \
        --title "chore(template): sync from mcp-ecosystem" \
        --body "$(cat <<EOF
Sync shared workflow/config/template baselines from \`verygoodplugins/mcp-ecosystem\`.

- Source commit: \`$SOURCE_SHA\`
- Sync date: \`$RUN_DATE\`
- Rendered managed workflow/config files from repo profiles in \`server-inventory.json\`
- Re-aligned managed dependency baselines with \`scripts/sync-template-baseline.mjs\`
- Validated the generated diff before opening this PR

This PR is generated from the ecosystem source of truth to reduce per-repo Dependabot drift.
EOF
)" >/dev/null; then
        echo "   PR creation failed"
        echo ""
        record_result "$SERVER_NAME" "blocked" "PR creation failed"
        continue
    fi

    echo "   Opened PR in $REPO_SLUG"
    echo ""
    record_result "$SERVER_NAME" "PR opened" "$REPO_SLUG"
done

if [[ -n "$SERVER_FILTER" && "$MATCHED_SERVER" != true ]]; then
    echo "❌ Unknown server: $SERVER_FILTER"
    record_result "$SERVER_FILTER" "blocked" "unknown server"
fi

print_result_table

if [[ "$HAS_BLOCKED_REPOSITORY" == true ]]; then
    exit 1
fi
