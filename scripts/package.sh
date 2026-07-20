#!/bin/bash
# package.sh — Bundle Fredy source into deliverables
# Produces 2 ZIP files:
#   1. Fredy-admin-v<ver>.zip      — source code (root folder = Fredy-admin/)
#   2. Fredy-admin-v<ver>-FULL.zip — FULL.md bundle (single concatenated doc)
# Usage: bash scripts/package.sh <version>
# Example: bash scripts/package.sh 12.0.5

set -e

VERSION="${1:?Usage: package.sh <version>}"
PROJECT_DIR="/home/z/my-project/Fredy-admin"
OUT_DIR="/home/z/my-project/deliverables"
STAMP=$(date -u +"%Y-%m-%d %H:%M:%S")

mkdir -p "$OUT_DIR"

ZIP_NAME="Fredy-admin-v${VERSION}.zip"
FULL_MD_NAME="Fredy-admin-v${VERSION}-FULL.md"
FULL_ZIP_NAME="Fredy-admin-v${VERSION}-FULL.zip"

echo "=== Packaging Fredy v${VERSION} ==="
echo "Source: $PROJECT_DIR"
echo "Output: $OUT_DIR"
echo ""

# ════════════════════════════════════════════════════════════
# 1. Source ZIP — root folder is "Fredy-admin/" (NOT flat)
# ════════════════════════════════════════════════════════════
echo ">>> Creating $ZIP_NAME (root: Fredy-admin/) ..."
# Strategy: cd to parent, zip the Fredy-admin folder by name.
# This ensures extracted files are under Fredy-admin/ — not dumped flat.
cd "$PROJECT_DIR/.."
rm -f "$OUT_DIR/$ZIP_NAME"
zip -r -q "$OUT_DIR/$ZIP_NAME" "Fredy-admin" \
  -x "Fredy-admin/node_modules/*" \
  -x "Fredy-admin/.wrangler/*" \
  -x "Fredy-admin/*.tsbuildinfo" \
  -x "Fredy-admin/.git/*" \
  -x "Fredy-admin/package-lock.json" \
  -x "Fredy-admin/bun.lock" \
  2>/dev/null || true

ZIP_SIZE=$(du -h "$OUT_DIR/$ZIP_NAME" | cut -f1)
echo "    ✅ $ZIP_NAME ($ZIP_SIZE, root=Fredy-admin/)"

# Verify the root folder structure
echo -n "    Verify root: "
unzip -l "$OUT_DIR/$ZIP_NAME" 2>/dev/null | head -5 | grep -o "Fredy-admin/" | head -1 && echo " ✅" || echo " ❌ NO ROOT FOLDER!"

# ════════════════════════════════════════════════════════════
# 2. Create FULL.md (concatenated source — single document)
# ════════════════════════════════════════════════════════════
echo ">>> Creating $FULL_MD_NAME ..."

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
} > "$OUT_DIR/$FULL_MD_NAME"

FULL_MD_SIZE=$(du -h "$OUT_DIR/$FULL_MD_NAME" | cut -f1)
echo "    ✅ $FULL_MD_NAME ($FULL_MD_SIZE, ${FILE_COUNT} files, ${LINE_COUNT} lines)"

# ════════════════════════════════════════════════════════════
# 3. FULL ZIP — the FULL.md wrapped in a zip (root = FULL.md)
# ════════════════════════════════════════════════════════════
echo ">>> Creating $FULL_ZIP_NAME ..."
rm -f "$OUT_DIR/$FULL_ZIP_NAME"
cd "$OUT_DIR"
zip -q "$FULL_ZIP_NAME" "$FULL_MD_NAME"
FULL_ZIP_SIZE=$(du -h "$OUT_DIR/$FULL_ZIP_NAME" | cut -f1)
echo "    ✅ $FULL_ZIP_NAME ($FULL_ZIP_SIZE)"

echo ""
echo "=== Packaging complete ==="
echo "Deliverables (3 files):"
ls -lh "$OUT_DIR/$ZIP_NAME" "$OUT_DIR/$FULL_MD_NAME" "$OUT_DIR/$FULL_ZIP_NAME"
