#!/bin/bash

# Exit on error
set -e

# Extract version from manifest.json
VERSION=$(grep '"version"' manifest.json | head -1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')
OUTPUT_FILE="aura-tab-v${VERSION}.zip"

echo "📦 Packaging Aura Tab v${VERSION} (Chrome Web Store — allowlist only)..."

if ! command -v zip &> /dev/null; then
    echo "Error: 'zip' command not found."
    exit 1
fi

rm -f aura-tab-v*.zip

# Allowlist: runtime files only (manifest, new tab page, service worker, i18n, CSS, JS, store assets).
# Excludes by omission: .git, .github, tests, node_modules, docs, tooling, dev assets (e.g. assets/other).
zip -r "$OUTPUT_FILE" \
    manifest.json \
    favicon-offscreen.html \
    newtab.html \
    background-worker.js \
    LICENSE \
    styles \
    scripts \
    _locales \
    assets/backgrounds \
    assets/icons \
    assets/changelog.json \
    -x "*.DS_Store" \
    -x "**/.DS_Store"

echo "✅ Compression complete!"
echo "You can upload $OUTPUT_FILE to the Chrome Web Store."
