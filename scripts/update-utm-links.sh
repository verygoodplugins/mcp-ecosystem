#!/bin/bash
# Update all README links with UTM tracking
# Usage: ./update-utm-links.sh <path-to-server>

set -e

SERVER_PATH="${1:-.}"
README="$SERVER_PATH/README.md"

if [[ ! -f "$README" ]]; then
    echo "❌ README.md not found at: $README"
    exit 1
fi

echo "🔗 Updating UTM links in: $README"
echo "================================================"

# Backup original
cp "$README" "$README.bak"

# Update links for each domain
DOMAINS=("verygoodplugins.com" "wpfusion.com" "automem.ai")

for domain in "${DOMAINS[@]}"; do
    # Replace https://domain.com) with https://domain.com?utm_source=github)
    # This handles markdown links like [text](https://domain.com)
    sed -i '' "s|https://$domain)|https://$domain?utm_source=github)|g" "$README"

    # Replace https://domain.com/ with trailing slash
    sed -i '' "s|https://$domain/)|https://$domain/?utm_source=github)|g" "$README"

    # Skip if already has utm_source
    # (the sed above will create double params, so fix those)
    sed -i '' "s|?utm_source=github?utm_source=github|?utm_source=github|g" "$README"
done

# Show changes
echo ""
echo "📋 Changes made:"
diff "$README.bak" "$README" || true

# Cleanup backup
rm "$README.bak"

echo ""
echo "✅ UTM links updated!"
