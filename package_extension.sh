#!/bin/bash

# Exit on error
set -e

# Extract version from manifest.json
VERSION=$(grep '"version"' manifest.json | head -1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')
OUTPUT_FILE="aura-tab-v${VERSION}.zip"

echo "📦 Packaging Aura Tab extension v${VERSION}..."

# check if zip command exists
if ! command -v zip &> /dev/null; then
    echo "Error: 'zip' command not found."
    exit 1
fi

# Remove existing zips if they exist (optional, but keeps it clean)
rm -f aura-tab-v*.zip

# Create the zip file
# -r: recurse into directories
# -x: exclude the following patterns
zip -r "$OUTPUT_FILE" . \
    -x "*.git*" \
    -x ".github/*" \
    -x "node_modules/*" \
    -x "tests/*" \
    -x "docs/*" \
    -x "coverage/*" \
    -x ".claude/*" \
    -x ".kiro/*" \
    -x "*/.DS_Store" \
    -x ".DS_Store" \
    -x ".gitignore" \
    -x "package.json" \
    -x "package-lock.json" \
    -x "vitest.config.js" \
    -x "*.zip" \
    -x "package_extension.sh" \
    -x "assets/other/*" \
    -x "*.md"

echo "✅ Compression complete!"
echo "You can upload $OUTPUT_FILE to the Chrome Web Store."
