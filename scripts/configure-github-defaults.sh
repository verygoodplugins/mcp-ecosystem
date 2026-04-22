#!/bin/bash
# Configure standard GitHub settings for VGP MCP repos.
# Usage: ./configure-github-defaults.sh <repo-slug|repo-name|path-to-repo>

set -euo pipefail

INPUT="${1:-}"
DEFAULT_GITHUB_ORG="${GITHUB_ORG:-verygoodplugins}"

usage() {
    echo "Usage: $0 <repo-slug|repo-name|path-to-repo>"
    echo ""
    echo "Examples:"
    echo "  $0 verygoodplugins/mcp-freescout"
    echo "  $0 mcp-freescout"
    echo "  $0 ../mcp-freescout"
    exit 1
}

if [[ -z "$INPUT" ]]; then
    usage
fi

if ! command -v gh >/dev/null 2>&1; then
    echo "❌ GitHub CLI (gh) is required"
    exit 1
fi

resolve_repo_slug() {
    local candidate="$1"
    local remote_url=""
    local base_name=""

    if [[ -d "$candidate" ]]; then
        if git -C "$candidate" rev-parse --git-dir >/dev/null 2>&1; then
            remote_url="$(git -C "$candidate" remote get-url origin 2>/dev/null || true)"
            if [[ -n "$remote_url" ]]; then
                case "$remote_url" in
                    git@github.com:*)
                        echo "${remote_url#git@github.com:}" | sed 's/\.git$//'
                        return 0
                        ;;
                    https://github.com/*)
                        echo "${remote_url#https://github.com/}" | sed 's/\.git$//'
                        return 0
                        ;;
                esac
            fi
        fi

        base_name="$(basename "$(cd "$candidate" && pwd)")"
        echo "$DEFAULT_GITHUB_ORG/$base_name"
        return 0
    fi

    if [[ "$candidate" == */* ]]; then
        echo "$candidate"
    else
        echo "$DEFAULT_GITHUB_ORG/$candidate"
    fi
}

REPO_SLUG="$(resolve_repo_slug "$INPUT")"

echo "🔧 Configuring GitHub defaults for $REPO_SLUG"
echo "================================================"

gh api -X PATCH "repos/$REPO_SLUG" \
  -F allow_auto_merge=true \
  -F delete_branch_on_merge=true \
  -F allow_squash_merge=true >/dev/null

gh api -X PUT "repos/$REPO_SLUG/vulnerability-alerts" >/dev/null
gh api -X PUT "repos/$REPO_SLUG/automated-security-fixes" >/dev/null

echo "✅ Updated repository settings"
gh api "repos/$REPO_SLUG" --jq '{allow_auto_merge,allow_squash_merge,delete_branch_on_merge}'

echo "✅ Enabled security automation"
echo "  - vulnerability alerts"
echo "  - automated security fixes"
