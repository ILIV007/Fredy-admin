#!/bin/bash
# package.sh — Bundle Fredy source into deliverables (zip + FULL.md)
# Usage: bash scripts/package.sh <version>
# Example: bash scripts/package.sh 12.0.0

set -e

VERSION="${1:?Usage: package.sh <version>}"
PROJECT_DIR="/home/z/my-project/Fredy-admin"
OUT_DIR="/home/z/my-project/deliverables"
STAMP=$(date -u +"%Y-%m-%d %H:%M:%S")

mkdir -p "$OUT_DIR"

ZIP_NAME="Fredy-admin-v${VERSION}.zip"
FULL_NAME="Fredy-admin-v${VERSION}-FULL.md"

echo "=== Packaging Fredy v${VERSION} ==="
echo "Source: $PROJECT_DIR"
echo "Output: $OUT_DIR"
echo ""

# ── 1. Create ZIP (source files only, no node_modules/.wrangler) ──
echo ">>> Creating $ZIP_NAME ..."
cd "$PROJECT_DIR"
zip -r -q "$OUT_DIR/$ZIP_NAME" . \
  -x "node_modules/*" \
  -x ".wrangler/*" \
  -x "*.tsbuildinfo" \
  -x ".git/*" \
  -x "package-lock.json" \
  2>/dev/null || true

ZIP_SIZE=$(du -h "$OUT_DIR/$ZIP_NAME" | cut -f1)
echo "    ✅ $ZIP_NAME ($ZIP_SIZE)"

# ── 2. Create FULL.md (concatenated source) ──
echo ">>> Creating $FULL_NAME ..."

# Collect file list (sorted, excluding node_modules and binaries)
FILES=$(cd "$PROJECT_DIR" && find . \
  -type f \
  -not -path "./node_modules/*" \
  -not -path "./.wrangler/*" \
  -not -path "./.git/*" \
  -not -name "*.tsbuildinfo" \
  -not -name "package-lock.json" \
  -not -name "*.zip" \
  -not -name "bun.lock" \
  | sort)

FILE_COUNT=$(echo "$FILES" | wc -l)
LINE_COUNT=$(echo "$FILES" | while read -r f; do
  [ -f "$PROJECT_DIR/${f#./}" ] && wc -l < "$PROJECT_DIR/${f#./}" 2>/dev/null || echo 0
done | awk '{s+=$1} END {print s}')

{
  echo "# Fredy Admin v${VERSION} — Full Source Code"
  echo ""
  echo "> Generated: ${STAMP}  "
  echo "> Version: v${VERSION}  "
  echo "> Files: ${FILE_COUNT} | Lines: ${LINE_COUNT}  "
  echo "> This document contains the complete source code of the Fredy v${VERSION} working directory."
  echo "> See V12_ARCHITECTURE.md for the architecture report."
  echo ""
  echo "---"
  echo ""

  echo "$FILES" | while read -r f; do
    REL="${f#./}"
    FULL_PATH="$PROJECT_DIR/$REL"
    if [ -f "$FULL_PATH" ]; then
      # Detect language for code fence
      EXT="${REL##*.}"
      case "$EXT" in
        ts)   LANG="typescript" ;;
        tsx)  LANG="tsx" ;;
        js)   LANG="javascript" ;;
        mjs)  LANG="javascript" ;;
        json) LANG="json" ;;
        md)   LANG="markdown" ;;
        toml) LANG="toml" ;;
        sh)   LANG="bash" ;;
        ini)  LANG="ini" ;;
        css)  LANG="css" ;;
        html) LANG="html" ;;
        yml|yaml) LANG="yaml" ;;
        *)    LANG="" ;;
      esac

      echo "## \`$REL\`"
      echo ""
      echo "(\`${REL}\`)  "
      echo ""
      echo "\`\`\`$LANG"
      cat "$FULL_PATH"
      echo ""
      echo "\`\`\`"
      echo ""
      echo "---"
      echo ""
    fi
  done
} > "$OUT_DIR/$FULL_NAME"

FULL_SIZE=$(du -h "$OUT_DIR/$FULL_NAME" | cut -f1)
echo "    ✅ $FULL_NAME ($FULL_SIZE, ${FILE_COUNT} files, ${LINE_COUNT} lines)"

echo ""
echo "=== Packaging complete ==="
echo "Deliverables:"
ls -lh "$OUT_DIR/$ZIP_NAME" "$OUT_DIR/$FULL_NAME"
