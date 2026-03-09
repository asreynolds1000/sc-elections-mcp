#!/bin/bash
# Pack sc-elections-mcp as a Desktop Extension (.mcpb)
# Uses a temp directory with production-only deps to keep the bundle small.

set -e

PACK_DIR=$(mktemp -d)
trap "rm -rf $PACK_DIR" EXIT

cp -r dist manifest.json package.json .mcpbignore "$PACK_DIR/"
cd "$PACK_DIR"
npm install --omit=dev --ignore-scripts --silent
npx @anthropic-ai/mcpb pack

MCPB_FILE=$(ls *.mcpb 2>/dev/null | head -1)
if [ -z "$MCPB_FILE" ]; then
  echo "ERROR: No .mcpb file generated" >&2
  exit 1
fi

OUTPUT="$OLDPWD/sc-elections-mcp.mcpb"
cp "$MCPB_FILE" "$OUTPUT"
echo ""
echo "Created: sc-elections-mcp.mcpb ($(du -h "$OUTPUT" | cut -f1))"
