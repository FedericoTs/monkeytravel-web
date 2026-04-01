#!/bin/bash
# ============================================================
# Activation Fix — Session Initialization Script
# Run this at the start of every coding session
# ============================================================

set -e

echo "=== MonkeyTravel Activation Fix — Session Init ==="
echo ""

# 1. Confirm working directory
echo "[1/6] Checking working directory..."
EXPECTED_DIR="/mnt/c/Users/Samsung/Documents/Projects/travel-app-web"
if [ "$(pwd)" != "$EXPECTED_DIR" ]; then
  echo "  ERROR: Wrong directory. Expected $EXPECTED_DIR"
  echo "  Current: $(pwd)"
  exit 1
fi
echo "  OK: $EXPECTED_DIR"

# 2. Check git status
echo ""
echo "[2/6] Git status..."
echo "  Branch: $(git branch --show-current)"
echo "  Last 5 commits:"
git log --oneline -5 | sed 's/^/    /'

# 3. Check for uncommitted changes
echo ""
echo "[3/6] Uncommitted changes..."
CHANGES=$(git status --porcelain | wc -l)
if [ "$CHANGES" -gt 0 ]; then
  echo "  WARNING: $CHANGES uncommitted changes detected"
  git status --short | head -10 | sed 's/^/    /'
else
  echo "  OK: Clean working tree"
fi

# 4. Read progress
echo ""
echo "[4/6] Progress summary..."
if [ -f activation-fix/claude-progress.txt ]; then
  # Show last session entry
  tail -20 activation-fix/claude-progress.txt | sed 's/^/    /'
else
  echo "  WARNING: No progress file found"
fi

# 5. Feature status
echo ""
echo "[5/6] Feature list status..."
if [ -f activation-fix/feature_list.json ]; then
  TOTAL=$(grep -c '"passes"' activation-fix/feature_list.json)
  PASSING=$(grep -c '"passes": true' activation-fix/feature_list.json || true)
  FAILING=$((TOTAL - PASSING))
  echo "  Total features: $TOTAL"
  echo "  Passing: $PASSING"
  echo "  Remaining: $FAILING"
  echo ""
  echo "  Next unfinished features (priority 1):"
  # Show first few unfinished priority 1 features
  python3 -c "
import json
with open('activation-fix/feature_list.json') as f:
    data = json.load(f)
for feat in data['features']:
    if not feat['passes'] and feat['priority'] == 1:
        print(f\"    [{feat['id']}] {feat['description']}\")
" 2>/dev/null || echo "    (install python3 to see feature details)"
else
  echo "  WARNING: No feature list found"
fi

# 6. Start dev server check
echo ""
echo "[6/6] Dev server..."
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 | grep -q "200"; then
  echo "  OK: Dev server running on port 3000"
else
  echo "  INFO: Dev server not running. Start with: npm run dev"
fi

echo ""
echo "=== Init complete. Ready to work on next feature. ==="
